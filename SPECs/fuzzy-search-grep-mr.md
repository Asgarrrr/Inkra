# Recherche de contenu dans le vault (fuzzy + grep)

Spec : [`fuzzy-search-grep-spec.md`](./fuzzy-search-grep-spec.md) · Plan d'exécution : [`fuzzy-search-grep-plan.md`](./fuzzy-search-grep-plan.md)

## Contexte

Writer indexe les **noms** de fichiers et sait faire du fuzzy dessus (`Cmd+P`), mais ne sait pas chercher dans le **texte** des documents. Pour une app qui vise les vaults Obsidian et les dépôts de docs, c'est le manque le plus visible face au concurrent direct : on ne peut pas retrouver une note dont on se souvient du contenu mais pas du nom.

## Ce que ça change

`Cmd+P` — ou le nouveau `Cmd+Shift+F`, qui ouvre la même palette — liste un groupe **In documents** sous les commandes et les noms de fichiers : les lignes matchées, surlignées, groupées par fichier, avec leur numéro, classées par pertinence. Cliquer un résultat ouvre le fichier, saute à la ligne, et flashe brièvement les mots qui ont matché.

Requête en mots simples : les fichiers contenant **tous** les tokens, proches les uns des autres. Préfixe `/` : recherche littérale. Casse intelligente dans les deux modes. Le scan démarre à 3 caractères, donc sauter à un fichier par son nom reste instantané.

**Décisions structurantes**, si vous ne lisez qu'un paragraphe : le fuzzy est au **niveau fichier**, pas ligne — la variante par ligne rend zéro sur `channels throughput` dès que le premier token est un titre et le second le paragraphe en dessous. Les numéros de ligne sont **relatifs au corps**, frontmatter exclu, parce que l'éditeur ne contient jamais le frontmatter — un numéro brut atterrit systématiquement trop bas et lève en fin de fichier. Les offsets voyagent en **points de code**, jamais en octets ni en UTF-16. Et il n'y a **qu'une** surface de recherche : une palette, pas deux.

## Forme du diff

55 fichiers, ~+7 200/−150, 8 commits.

| Zone                                    | Fichiers | Lignes |
| --------------------------------------- | -------- | ------ |
| Rust (scan, ranking, commande streamée) | 6        | +1 625 |
| Frontend (palette, éditeur, navigation) | 27       | +1 093 |
| Tests TS                                | 13       | +2 193 |
| E2E                                     | 1        | +770   |
| Docs, spec, plan, CHANGELOG             | 8        | +1 572 |

Le ratio test/production est volontaire : la couche de rendu est hors de portée du runner (`environment: "node"`, pas de `.tsx`), donc tout ce qui est décidable a été sorti en modules purs et le reste est couvert par le harnais e2e.

**Un commit par slice**, relisibles dans l'ordre : dépendances · cœur de scan et ranking Rust · commande streamée et transport · palette · porteur de cible et correctifs de navigation · saut à la ligne · flash. Le bump `ignore` est en commit de tête, révocable seul.

## Vérification

```
cd apps/desktop           && vp check      → 0 errors, 1 warning (préexistant, e2e/wdio.conf.js)
cd apps/desktop           && vp test       → 697 passés
cd apps/desktop/src-tauri && cargo test    → 207 passés
cd apps/desktop/e2e       && pnpm exec wdio run ./wdio.conf.js --spec ./specs/content-search.spec.js
                                           → 13 scénarios
```

Le bundle e2e se construit **uniquement** par `e2e/package.json` → `build:app`. Un `cargo tauri build` nu produit une app sans plugin WebDriver, ce qui se manifeste par un timeout de création de session, et écrase le bundle valide au passage.

Chaque slice est passée par trois revues en contexte frais — conformité et légitimité des tests, adversarial, code review du domaine — puis une remédiation. **Les six ont bloqué le premier jet.**

## Risques et retour arrière

**Contrat de fraîcheur** : le scan lit le disque, l'utilisateur lit son buffer. Une phrase qu'on vient de taper n'est trouvable qu'après sauvegarde. Acté dans la spec.

**Un seul scan en vol par fenêtre**, annulation coopérative par génération. Tauri n'a pas d'annulation first-class, et `Channel::send` est fire-and-forget : la génération est le **seul** mécanisme d'arrêt, pas le chemin d'erreur.

**Limites déclarées, pas oubliées** : pas de regex, pas de search-and-replace, pas de fichiers non-markdown, pas d'index inversé, pas de recherche dans les buffers non sauvegardés, pas de toggle de casse dans l'UI.

Retour arrière : `git revert` du commit de slice concerné. Les slices 5 et 6 sont purement additives côté produit ; révoquer la 6 laisse le saut sans flash, révoquer la 5 laisse l'ouverture sans saut.

## Partie 2 — la tenue à l'échelle n'est pas mesurée

**C'est l'inconnue principale de cette MR.** La feature n'a jamais tourné sur autre chose qu'un vault de test. Ce qu'on sait analytiquement, sans l'avoir mesuré :

- le scan est **séquentiel** et **lit chaque fichier** de l'index ; il ne s'arrête tôt que si un plafond est atteint ;
- les plafonds sont `total_cap = 500`, `per_file_cap = 10`, `max_bytes = 2 Mio` par fichier. Une requête sur un token **fréquent** atteint le plafond vite et rend la main ; une requête sur un token **rare** force un parcours complet — c'est le pire cas, et c'est aussi un cas d'usage réel ;
- l'index est **cloné à chaque invocation**. La slice 2 a mesuré ~186 o/entrée, soit ~3 Mo à 20 000 fichiers ; le clone a été déplacé dans le `spawn_blocking` pour cette raison. À 1 M de fichiers la même arithmétique donne ~186 Mo par recherche, ce qui n'a jamais été vérifié ;
- le debounce est à 150 ms et le seuil à 3 caractères, donc une frappe rapide ne déclenche qu'un scan — mais chaque scan abandonné coûte un aller-retour IPC.

Ce qu'il faudrait pour trancher : un générateur de vault synthétique paramétré (arborescence imbriquée, tailles réalistes, une fraction avec frontmatter, ~1 % de lignes pathologiques type base64 ou JSON minifié, tokens plantés à densité connue), mesuré par paliers 1k / 10k / 100k / 1M, en **release**, sur quatre formes de requête — token rare, token fréquent, deux tokens, littéral. Métriques : temps d'indexation, empreinte de l'index, **temps jusqu'au premier lot** (la latence perçue) et temps jusqu'à la fin.

À faire dans une MR séparée : c'est de la caractérisation, pas une correction, et le harnais a sa propre valeur pour la prochaine fois qu'on touche au scan.

## Autres suites connues

- `e2e/specs/latex-math.spec.js` échoue sur ses 4 scénarios. **Préexistant**, vérifié identique sur `master` — sans rapport avec cette branche. Noté dans `TODOS.md`.
- `prefers-reduced-motion` n'est pas prouvé de bout en bout pour le flash : la règle CSS et la couleur de repos sont mesurées, mais faire matcher la media query depuis le harnais WebDriver s'est avéré impossible.
- Dérive de lockfile : `@tauri-apps/api` 2.10.1 contre le crate `tauri` 2.11.2, tous deux déclarés `^2`. tauri-cli 2.11.4 la traite en erreur de build ; contournée par `--ignore-version-mismatches`, jamais tranchée. Un `vp install` la ferme, mais ça mérite son propre commit.
