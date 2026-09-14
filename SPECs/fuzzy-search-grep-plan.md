# Plan d'exécution — Recherche de contenu (fuzzy + grep)

Spec : [`fuzzy-search-grep-spec.md`](./fuzzy-search-grep-spec.md)
Branche : `feat/content-search`

Document vivant. Chaque slice est mise à jour ici au fur et à mesure :
statut, décisions prises, écarts au plan initial, preuve de vérification.

## Reprendre ici

Ce fichier est le document de reprise. Une session fraîche n'a besoin que de
lui, de la spec, et de `docs/workflows/agent-review.md`.

État : **feature close.** Slices 0–6 commitées sur `feat/content-search`
(8 commits), arbre propre. Il ne reste rien à implémenter ; la branche est
prête pour la PR.

Lire dans cet ordre : « Conventions de travail » (la méthode, y compris les
trois revues de fin de slice), « Décisions figées », « Écarts au plan initial »
(`[D-1]` à `[D-4]`), puis le « Résultat » de chaque slice — ils portent les
risques résiduels assumés, qui sont ce qu'une session de maintenance doit
connaître avant de toucher à cette feature.

Vérification de base à retrouver avant de toucher quoi que ce soit :

```
cd apps/desktop/src-tauri && cargo test          → 207 passed
cd apps/desktop && ../../node_modules/.bin/vp check   → 0 errors, 1 warning
cd apps/desktop && ../../node_modules/.bin/vp test    → 697 passed
```

L'unique warning est préexistant, dans `e2e/wdio.conf.js`, hors périmètre.
`vp` n'est pas sur le `PATH` : il vit dans `node_modules/.bin/` à la racine du
repo.

**Environnement déjà en place, ne pas le refaire :** `node_modules` installé,
`tauri-webdriver` et `tauri-cli` installés via cargo, et le bundle e2e construit
dans `apps/desktop/src-tauri/target/release/bundle/macos/Writer.app`. Le harnais
e2e sert à couvrir la couche de rendu, que le runner node-only n'atteint pas —
`apps/desktop/e2e/specs/content-search.spec.js` est auto-amorçant et rejouable :

```
cd apps/desktop/e2e && pnpm exec wdio run ./wdio.conf.js --spec ./specs/content-search.spec.js
```

Rebuild obligatoire après toute modif frontend (l'app embarque les assets
construits), et le `beforeBuildCommand` de Tauri appelle `vp build` — préfixer
par `export PATH="<repo>/node_modules/.bin:$PATH"` sinon le build meurt en 127.

## Statut

| Slice | Sujet                                    | Statut                           |
| ----- | ---------------------------------------- | -------------------------------- |
| 0     | Dépendances                              | ✅ fait                          |
| 1     | Cœur de scan et ranking (Rust)           | ✅ fait (3 revues + remédiation) |
| 2     | Commande streamée, annulation, transport | ✅ fait (3 revues + remédiation) |
| 3     | Palette                                  | ✅ fait (3 revues + remédiation) |
| 4     | Porteur de cible + correctifs navigation | ✅ fait (3 revues + remédiation) |
| 5     | Saut à la ligne                          | ✅ fait (3 revues + remédiation) |
| 6     | Flash bref                               | ✅ fait (3 revues + remédiation) |

## Conventions de travail

- Une slice = un commit. Un sous-agent implémenteur par slice.
- **Commentaires minimes.** Un commentaire explique un _pourquoi_ non évident
  (invariant, piège, contrainte externe). Jamais de narration du diff, jamais de
  redite de la signature. Le code existant est plus bavard que cette règle —
  ne pas s'en inspirer.
- Pas de refactor opportuniste, pas d'abstraction spéculative.
- Vérification obligatoire avant de clore une slice (commandes + sortie collées).
- **Fin de slice : trois sous-agents en contexte frais, en parallèle**, avant le
  commit — jamais dans l'agent qui a écrit le code
  (cf. [`docs/workflows/agent-review.md`](../docs/workflows/agent-review.md),
  section « Context Isolation ») :
  1. **Blue team** — conformité au plan et légitimité des tests. Re-dérive
     indépendamment les parties risquées, vérifie qu'aucune assertion n'est
     vide ou tautologique. Persona _QA Engineer_.
  2. **Red team** — adversarial. Cherche l'entrée qui casse : panic, résultat
     faux, blowup quadratique, race, invariant violé.
  3. **Code review** — persona du domaine touché (_Rust/Tauri Expert_,
     _React/Frontend_, _Editor_…) contre le brief et la checklist qualité.

  Format de restitution : celui de `agent-review.md` (findings P0..P3,
  fichier:ligne, impact, cause racine, direction de correctif). Un P0 ou un P1
  non résolu bloque le commit.

## Contexte

Writer indexe les **noms** de fichiers et sait faire du fuzzy dessus (`Cmd+P`),
mais ne sait pas chercher dans le **texte** des documents. Pour une app qui vise
les vaults Obsidian et les dépôts de docs, c'est le manque le plus visible face
au concurrent direct : on ne peut pas retrouver une note dont on se souvient du
contenu mais pas du nom.

Résultat visé : `Cmd+Shift+F` ouvre une palette qui cherche dans tous les
markdown du workspace, affiche des extraits classés et surlignés groupés par
fichier, et un clic ouvre le fichier en sautant à la ligne matchée avec un flash
bref.

Ce plan est la deuxième version. La première a été soumise à une revue
contradictoire (validation factuelle + red team) qui a trouvé trois défauts
invalidants, tous confirmés dans le code. Ils sont corrigés ici et signalés
comme **[RT-n]**.

## Décisions figées

| Point             | Choix                                                                       | Pourquoi                                                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sémantique fuzzy  | **Niveau fichier** : tous les tokens présents quelque part dans le fichier  | Conforme à la spec (`:46`, « rank **files** whose content contains the tokens »). La variante par ligne renvoyait zéro sur `channels throughput` quand le premier token est un heading et le second le paragraphe en dessous — et sur toute prose wrappée à 80 colonnes. **[RT-3]** |
| Snippet           | La ligne du fichier contenant le plus de tokens ; départage par la première | Règle unique et explicable, lève l'ambiguïté du snippet en mode fichier.                                                                                                                                                                                                            |
| Proximité         | Scorée sur une fenêtre de lignes, pas sur le fichier entier                 | Deux tokens à 3 lignes d'écart valent mieux qu'à 300.                                                                                                                                                                                                                               |
| Mode grep         | Préfixe `/` → littéral, pas de ranking                                      | Conforme à la spec.                                                                                                                                                                                                                                                                 |
| Casse             | **Smart case** dans les deux modes                                          | Exigé par la spec (`:20`) : seul le _toggle UI_ est hors scope, pas le comportement.                                                                                                                                                                                                |
| Espace de lignes  | Le Rust émet des numéros **relatifs au corps**, frontmatter exclu           | L'éditeur ne contient jamais le frontmatter. Voir [RT-1].                                                                                                                                                                                                                           |
| Unité des offsets | **Points de code**, jamais des octets                                       | Voir [RT-2].                                                                                                                                                                                                                                                                        |
| Transport         | `tauri::ipc::Channel` (lots)                                                | Les docs Tauri v2 disent que le système d'events n'est pas fait pour le haut débit.                                                                                                                                                                                                 |
| Annulation        | Génération coopérative + un seul scan en vol par fenêtre                    | Tauri n'a pas d'annulation first-class ([#8351](https://github.com/tauri-apps/tauri/issues/8351) ouvert).                                                                                                                                                                           |
| Matcher           | `grep-regex` (un matcher **par token**), pas d'alternation                  | Voir [D-1].                                                                                                                                                                                                                                                                         |

## Les trois défauts corrigés

**[RT-1] Décalage de lignes par le frontmatter — cassait la feature sur le public visé.**
`frontmatter.ts:22` fait `body: raw.slice(match[0].length)` : le bloc frontmatter
**et ses délimiteurs `---`** sont retirés. `editor-store.ts:308` charge
`content: parsed.body`. Le document CodeMirror n'est donc jamais le fichier tel
que scanné sur disque. Un numéro de ligne brut appliqué à
`view.state.doc.line(n)` atterrit `lignes_frontmatter + 2` trop bas, et **lève un
`RangeError`** quand le match est en fin de fichier.
→ Le scan Rust détecte le frontmatter, **ne le scanne pas**, et émet des numéros
relatifs au corps. Le frontend n'a alors aucune conversion à faire.
→ Il n'existe **aucun** parseur de frontmatter réutilisable côté Rust :
`commands/fs.rs:47 extract_title` porte sa propre logique inline, qui diverge de
`FRONTMATTER_RE` (elle accepte `\r\n`). Le découpage doit donc être écrit pour
mirrorer `FRONTMATTER_RE` (`frontmatter.ts:3`) **exactement**, et être testé
contre les mêmes cas. Le jump doit malgré tout **clamper** `n` à `doc.lines`, le
fichier ayant pu changer entre le scan et le clic.

**[RT-2] Offsets octets consommés comme index JS.**
`grep-matcher` rend des offsets **octets**. Le code existant sait déjà que c'est
un piège : `search.rs:109-110` fait `haystack[..byte_start].chars().count()` pour
convertir en points de code, et `HighlightedPath` itère avec `Array.from` (donc
par points de code).
→ Le Rust convertit en **points de code** avant l'envoi, cohérent avec les deux
précédents. Côté JS, découper avec `Array.from`, jamais
`String.prototype.slice` (qui indexe en UTF-16 et se décalerait sur les emoji).
Un accent suffit à décaler d'un.

**[RT-3] Sémantique fuzzy** — traitée dans le tableau ci-dessus.

## Écarts au plan initial

**[D-1] `grep-searcher` écarté ; `grep-regex` + `grep-matcher` seulement.**
Le plan initial prévoyait les trois sous-crates. `grep-searcher` n'apporte rien
ici :

- son streaming est moot — le corps doit être en mémoire de toute façon pour le
  découpage frontmatter ;
- sa détection de binaire est couverte gratuitement par la validation UTF-8 ;
- son `heap_limit` est un **piège** que le plan initial documentait lui-même :
  une seule ligne plus longue que la limite fait échouer la recherche sur _tout
  le fichier_ (`BufferAllocation::Error`), donc une note contenant un bloc de
  JSON minifié disparaîtrait silencieusement, y compris pour ses lignes de prose
  normales. En lisant le fichier nous-mêmes sous un plafond de taille, ce mode
  de défaillance n'existe pas ;
- ses offsets octets sont la cause racine de [RT-2] ; en travaillant sur `&str`
  les offsets points-de-code se calculent directement.

`grep-regex` est conservé et porte la vraie valeur : matching littéral
insensible à la casse avec repli Unicode correct, offsets rendus dans les
octets **d'origine**. Le faire à la main via `to_lowercase()` + `find()` est le
piège classique — `'İ'` se minuscule en 2 points de code, et les offsets calculés
dans la chaîne minusculée ne remappent plus sur l'originale.

**[D-2] Un matcher par token, pas une alternation.**
`RegexMatcherBuilder::build_literals` délègue à `build_many`, qui construit une
alternation. Le crate `regex` a une sémantique **leftmost-first** : sur les
tokens `{ab, bc}` et le texte `abc`, l'alternation matche `ab` puis reprend au
point 2 et ne voit jamais `bc` — le filtre AND rejetterait à tort le fichier.
Trier par longueur décroissante ne corrige que le cas préfixe, pas le
chevauchement. Un `RegexMatcher` par token (`.fixed_strings(true)`) est exact et
rend l'attribution token→match gratuite.

## Contraintes vérifiées

- **`ignore` bumpé 0.4.25 → 0.4.33.** [PR #3475](https://github.com/BurntSushi/ripgrep/pull/3475)
  (2026-07-16) corrige un deadlock du walker quand une closure visiteur panique
  → garder les closures panic-free.
- Crates : `grep-regex` 0.1.14, `grep-matcher` 0.1.9. Prendre les sous-crates,
  **pas** l'ombrelle `grep` (0.4.1, retardée).
- `tauri` 2.11.2 : `Channel<TSend>` avec `send(&self, TSend) -> tauri::Result<()>`
  et `id() -> u32`, implémente `CommandArg` (donc paramètre direct de commande),
  borne `TSend: IpcResponse` avec impl générique pour tout `Serialize` — **pas
  besoin de `Clone`**. `send` est synchrone et `&self`, sûr depuis
  `spawn_blocking`.
- `@tauri-apps/api` 2.10.1 : `import { Channel } from '@tauri-apps/api/core'`.
- **Réserve** : `send` passe par `webview.eval` ; sa remontée d'erreur sur une
  webview détruite n'est pas garantie. Ne pas faire reposer l'arrêt du scan
  uniquement sur le chemin `Err` — la génération reste le mécanisme primaire.

---

## Slice 0 — Dépendances ✅

`ignore` 0.4.25 → 0.4.33, ajout de `grep-matcher` 0.1.9 et `grep-regex` 0.1.14.
Commit de tête, révocable seul.

## Slice 1 — Cœur de scan et ranking en Rust

Aucune IPC. Tout est une fonction pure, testable.

```rust
pub fn content_search_impl(
    files: &[IndexedFile],
    query: &ContentQuery,      // tokens, mode (Fuzzy | Literal), smart case
    opts: &ContentSearchOpts,  // per_file_cap ~10, total_cap ~500, max_bytes
    cancel: &dyn Fn() -> bool,
    emit: &mut dyn FnMut(Vec<ContentMatch>) -> ControlFlow<()>,
) -> ContentSearchStats
```

`emit` est le point de testabilité : en test il pousse dans un `Vec`, en prod il
envoie sur le Channel. `ControlFlow` porte l'arrêt (échec d'envoi, plafond
atteint).

**Source des fichiers** : itérer `state.file_index` (déjà filtré gitignore,
markdown seulement, en mémoire), pas un nouveau `WalkBuilder`. **Cloner le
`Vec<IndexedFile>` et relâcher le `RwLock` avant toute I/O** — discipline
documentée à `commands/fs.rs:233-241` : tenir le lock pendant les lectures gèle
le switch de workspace.

**Garde de taille** — `IndexedFile` (`state.rs:70-76`) n'a **pas** de champ
taille, et il n'y a pas de walker : le cap se fait par `metadata()` avant
lecture, dans `content_search_impl`.

**Ordre d'émission** : ordre de l'index, en streaming. Le tri par score est fait
côté frontend au fil des lots (voir slice 3). Pas de barrière globale en Rust.

**Ranking niveau fichier**, score décroissant :

1. Tous les tokens présents dans le fichier (AND) — sinon éliminé.
2. Proximité : plus petite fenêtre de lignes couvrant tous les tokens.
3. Token trouvé sur une ligne de heading → bonus.
4. Nombre total de hits.
5. Match sur le stem du nom de fichier → départage.

Ne **pas** réutiliser `fuzzy_search_impl` (`search.rs:224`) : son scoring est
entièrement dérivé du chemin (`in_filename`, offset dans le chemin, longueur du
chemin). Reprendre seulement la normalisation `' '`↔`'-'` (`search.rs:89-98`)
pour le test de stem, et la forme sort+truncate.

**Ordre intra-fichier** : `(nombre de tokens sur la ligne desc, numéro de ligne
asc)`, tronqué à `per_file_cap`. La tête est le snippet. En mode littéral toutes
les lignes ont un seul token, donc ça dégénère en ordre de ligne.

**Politique d'erreur par fichier** : skip + compteur remonté dans les stats.
UTF-8 invalide, fichier trop gros, `metadata`/`read` en échec → skip silencieux
compté, jamais d'échec global du scan.

**Tests** — dans le `#[cfg(test)] mod tests` existant (`search.rs:297-441`,
fixture `setup_workspace()` à `:303-314`, `tempfile` en dev-dep) : ordre de
classement, AND multi-tokens à travers des lignes distantes, tokens qui se
chevauchent (`{ab, bc}` sur `abc` — régression [D-2]), bonus heading, mode
littéral, smart case dans les deux modes, **numéros de ligne corrects sur un
fichier avec frontmatter** (+ parité avec `FRONTMATTER_RE` sur ses cas limites :
frontmatter vide, sans `\n` final, non fermé), **plages en points de code sur
une ligne accentuée et une ligne avec emoji**, plafonds par fichier et total,
annulation en cours, fichier binaire ignoré, fichier trop gros ignoré.

**Vérification** : `cargo test`, `cargo clippy`, `cargo fmt --check` depuis
`src-tauri/`.

### Résultat — livrée après trois revues et une passe de remédiation

Les trois revues (code review Rust/Tauri, blue team QA, red team) ont **toutes
bloqué** le premier jet. Chacune a trouvé un défaut que les deux autres avaient
manqué. Ce qu'elles ont validé, elles, solidement : parité `FRONTMATTER_RE`
(16 cas re-dérivés à la main), offsets points-de-code, `[RT-3]`, `[D-2]`,
annulation, `min_line_span` et `merge_ranges` (fuzzés 3000 cas chacun contre une
force brute), comptabilité des caps (96 combinaisons), zéro panic sur ~25
entrées hostiles.

Défauts corrigés :

- **Conversion points-de-code quadratique.** `line[..m.start()].chars().count()`
  repartait de l'octet 0 à chaque match. Mesuré : 8,9 s (release) pour _un_
  fichier sur une ligne de 2 Mio, non interruptible (`cancel()` n'est testé
  qu'entre fichiers). Ce n'est pas une entrée synthétique : une image base64
  inline, un bloc de JSON minifié ou une ligne de CSV collée sont des lignes
  longues ordinaires dans un vault Obsidian. Corrigé par un curseur
  `(byte, char)` monotone — `find_iter` rend les matches en ordre croissant.
- **`line_content` non borné.** Les caps bornaient le _nombre_ de matches,
  jamais leur _taille_ : plafond théorique 500 × 2 Mio ≈ 1 Go à travers
  `Channel` → `webview.eval`. Cause racine distincte de la précédente. Corrigé
  par une fenêtre de `MAX_SNIPPET_CHARS` (400) autour du premier match, plages
  rebasées, plus un drapeau `line_truncated`. Plages plafonnées à
  `MAX_RANGES_PER_LINE` (50) — une ligne pathologique en produisait 209 714.
- **Un `\r` isolé désynchronisait `line_number` de l'éditeur.** `str::lines()`
  ne coupe que sur `\n` ; CodeMirror coupe sur `DefaultSplit = /\r\n?|\n/` et le
  repo ne configure aucun `lineSeparator` (les deux vérifiés). Le numéro restait
  _dans les bornes_ mais faux, donc le clamp `doc.lines` de la slice 5 ne
  l'attrapait pas. Même famille que `[RT-1]`. Corrigé par `split_lines`, qui
  mirrore `DefaultSplit`.
- **La pile de scores inversait l'ordre du plan.** `HEADING_BONUS` valait 50
  crans de proximité et le terme hits en traversait 5 : les règles 3 et 4
  écrasaient la règle 2. Rebandé pour que la plage totale de chaque tier reste
  strictement sous le pas du tier supérieur, avec un commentaire qui épingle
  l'invariant.
- **Le harnais de test certifiait ce qu'il ne testait pas.** Sur 20 mutations,
  5 passaient inaperçues : `PROXIMITY_STEP = 0` (le test de proximité était
  satisfait par l'ordre de déclaration de la fixture et la stabilité du tri),
  suppression du tri intra-fichier, suppression du bonus stem, suppression du
  terme hits, et un test d'exclusion vrai sur ensemble vide. Les cinq sont
  maintenant fermées, chacune vérifiée rouge/vert.
- Divers : `truncated` faux-positif au cap exact ; normalisation de stem
  unidirectionnelle (un token avec tiret ne matchait jamais) ; mode littéral
  multi-token qui dégradait AND en OR ; NBSP accepté comme délimiteur de
  heading ; `find_iter` dont le `Result` était jeté.

Ajouts au contrat par rapport au plan initial, à répercuter en slice 2 :

- `ContentSearchStats.outcome: ContentSearchOutcome`
  (`Completed | Cancelled | Aborted | Failed`). Un scan annulé rendait des stats
  de forme identique à un scan complet, alors que la slice 2 en dérive l'état
  terminal. **La slice 2 ne doit pas déduire la terminaison de `total`.**
- `ContentMatch.line_truncated: bool` — le stub TS `ContentSearchResult` doit
  donc gagner `score`, `relative_path` **et** `line_truncated`.
- `ContentSearchOpts.batch_size`.

**Risques résiduels assumés :**

- Le correctif quadratique n'a **pas** de test rouge/vert : il préserve le
  comportement, son seul observable est le temps. La fixture de ligne longue
  (210 Ko) sert de canari — une régression rend la suite visiblement lente sans
  la faire échouer. Une assertion temporelle serait flaky ; instrumenter un
  compteur serait disproportionné.
- 30 warnings `dead_code` portés jusqu'à la slice 2 (`mod commands` est privé,
  rien n'appelle l'API tant que la commande n'est pas enregistrée). Décision
  explicite : pas de `#[allow]`, ils disparaissent à l'enregistrement.
- `İ`/`ß` ne matchent pas sous simple case folding — limitation de rappel,
  cohérente avec ripgrep.
- Le bonus heading se déclenche sur un `#` dans un bloc de code clôturé. Accepté
  par le plan ; la red team a confirmé que c'est le seul faux positif de sa
  classe.
- La proximité sature à 1000 lignes d'écart.
- `read_searchable` fait `metadata()` puis `read()` : un fichier qui grossit
  entre les deux est lu au-delà de `max_bytes`. Non démontré, noté.

## Slice 2 — Commande streamée, annulation, transport frontend

**Protocole d'événements** — à définir explicitement, sinon deux implémenteurs
divergent :

```rust
#[derive(serde::Serialize)]
#[serde(tag = "event", content = "data")]
pub enum ContentSearchEvent {
    Matches(Vec<ContentMatch>),
    Done(ContentSearchStats),   // total, truncated, skipped_files
}
```

`Done` est le signal de terminaison : il alimente l'état vide (« aucun résultat »
vs « scan en cours ») et l'indicateur « Searching… » au-delà de 200ms exigé par
la spec (`:74`).

**Commande** — copier `find_file_by_name` (`search.rs:284-295`), la seule
commande `async` du fichier, qui utilise `spawn_blocking`. `fuzzy_search` et
`index_workspace` sont synchrones ; un scan disque synchrone gèlerait l'UI.

```rust
#[tauri::command]
pub async fn search_workspace_content(
    query: String, mode: String,
    on_event: Channel<ContentSearchEvent>,
    webview: tauri::Webview, app: tauri::AppHandle,
) -> Result<(), AppError>
```

`workspace_snapshot()` → `AppError::NoWorkspace` si absent. C'est aussi la porte
qui protège les fenêtres compactes, qui n'ont pas d'index.

**Annulation** — `content_search_generation: AtomicU64` sur `WorkspaceState`
(per-fenêtre, donc pas de collision multi-fenêtres), incrémenté à chaque nouvelle
recherche, comparé dans la boucle. Tear-down via `reset_workspace_runtime`
(`state.rs:111-132`).

**Un seul scan en vol par fenêtre.** L'annulation est coopérative _entre_
fichiers : un `fs::read` bloqué sur un placeholder iCloud ne peut pas
l'observer. Sans garde, une requête de 30 caractères tapée avec des pauses >
debounce lance ~8 `spawn_blocking` tous coincés sur les mêmes lectures.
→ refuser de lancer tant que la génération précédente n'a pas acquitté son arrêt.

**Contrat de fraîcheur** — le scan lit le disque, l'utilisateur lit son buffer.
Chercher une phrase qu'on vient de taper ne la trouve pas tant que la sauvegarde
n'a pas eu lieu. Pour la v1 : l'acter dans la spec et la doc.

**Frontend** — `src/types/fs.ts` : `ContentSearchResult` (`:36-41`) est un
**stub orphelin vérifié** (zéro producteur, zéro consommateur dans tout le
repo). L'adopter en l'étendant (il manque `score` et `relative_path`) plutôt
qu'en ajouter un. `src/lib/tauri.ts` : wrapper suivant la convention camelCase.
Hook `use-content-search.ts` : debounce ~150ms (les 50ms de
`use-fuzzy-search.ts:21` visent un scan mémoire), **un `Channel` neuf par
recherche gardé en ref** — les messages d'un ancien channel sont ignorés parce
que la ref ne pointe plus dessus, ce qui corrige par construction le bug latent
de `use-fuzzy-search.ts:20` (`.then(setResults)` sans garde de séquence).

**Tests** : paire `invoke` dans `tests/tauri-ipc.test.ts` (convention
`vi.mock("@tauri-apps/api/core")`), et le hook en isolation — accumulation des
lots, rejet d'un channel périmé, transition vers l'état terminal.

### Résultat — livrée après trois revues et une passe de remédiation

Les trois revues (code review Rust/Tauri + React, blue team QA, red team) ont
**toutes bloqué** le premier jet, et sur le même diagnostic : 13 mutations sur
36 survivaient, toutes dans deux régions — le corps du `#[tauri::command]` et le
hook React. Les deux étaient intestables pour la même raison : la logique était
inlinée là où aucun test ne peut construire les dépendances. Le correctif est
structurel, pas « plus d'assertions ».

La pire tenait en un caractère : `fetch_add(1) + 1` → `fetch_add(1)` faisait
capturer à chaque scan sa génération _avant_ incrément, donc se lire lui-même
comme périmé et sortir avant toute I/O. La recherche de contenu ne rendait plus
jamais rien, suite verte.

Défauts corrigés :

- **Corps de commande extrait** en `run_content_scan(state, generation, query,
opts, emit)` et `next_content_search_generation(state)`.
  `WorkspaceState::default()` se construit en test et `file_index` se remplit
  directement, donc un `emit` enregistreur couvre tout le protocole.
- **Chemin de sortie sans événement terminal.** Le retour « périmé avant le
  lock » ne renvoyait pas de `Done`. Périmé par une _recherche plus récente_
  est inoffensif, mais périmé par `reset_workspace_runtime` ne l'est pas : aucun
  scan plus récent n'existe, le frontend croit encore au channel, `isSearching`
  reste `true` pour toujours. Désormais un `Done(Cancelled)` part sur **tous**
  les chemins, et un test pilote `run_content_scan` à travers les six
  (requête illisible, périmé avant lock, annulé en cours, `emit` qui rompt,
  plafond atteint, complétion) en asservissant l'invariant « exactement un
  terminal, en dernier ».
- **Génération incrémentée avant les gardes.** Taper `/` seul, ou effacer
  jusqu'au blanc, laissait tourner le scan précédent sur tout le workspace —
  et tenir `content_search_lock`, donc la requête suivante faisait la queue
  derrière un scan abandonné.
- **Clone de l'index déplacé dans le `spawn_blocking`, après le test de
  péremption.** 186 o/entrée, soit ~3 Mo par invoke à 20 000 fichiers, payés y
  compris par les requêtes qui sortent immédiatement — et payés sur le thread
  de l'exécuteur async, le seul endroit où cette commande ne doit pas bloquer.
- **Attente bornée au lieu d'un `lock()` bloquant** (voir écarts ci-dessous).
- **Orthographes des quatre `outcome` épinglées** et **contrat de transport
  vérifié des deux côtés** : `shared/content-search-event.contract.json`, lu par
  Rust en `include_str!` et importé par TS, sur le modèle de
  `workspace-identity.contract.json`. L'ancien test n'épinglait que le JSON
  Rust ; renommer `line_truncated` côté TS restait vert pendant que la palette
  affichait `undefined`.
- **Contrat de streaming épinglé.** Le harnais aplatissait tous les lots en un
  `Vec`, donc `batch_size = usize::MAX` passait inaperçu.
- **Hook testé pour de vrai.** Un mini-runtime de hooks (`tests/helpers/
fake-react.ts`, ~100 lignes) exécute la vraie source sous `environment:
"node"` : debounce, délai d'indicateur, les _deux_ gardes d'identité de
  channel, l'`outcome` « failed » synthétisé, le `channelRef = null` du
  nettoyage, et le double-effet façon StrictMode.
- **Session clefée sur sa requête.** `setSession(emptySession())` n'était appelé
  que _dans_ le callback de debounce : pendant ≥150 ms après chaque frappe, le
  hook rendait la session de la requête précédente, `isComplete: true` et stats
  réelles — une palette lisant `isComplete && results.length === 0` affichait un
  « No results found » définitif pour une requête dont le scan n'avait pas
  commencé. La session porte maintenant sa `query` et le hook expose `isStale`.
- **Annulation explicite.** Rien ne disait à Rust d'arrêter quand la palette se
  ferme ou que l'entrée se vide. `ControlFlow::Break` est mort en pratique : la
  red team a confirmé la « réserve » du plan, `Channel::send` → `Webview::eval`
  → `send_user_message` est fire-and-forget et ne rend `Err` qu'à l'extinction
  de l'app. La génération est donc le **seul** mécanisme d'arrêt, d'où
  `cancel_workspace_content_search`, appelé au nettoyage de l'effet.
- **Scan annulé qui figeait un jeu de résultats inter-workspace.**
  `reset_workspace_runtime` arrête le scan, mais les lots déjà émis portaient
  des chemins absolus dans l'**ancien** workspace et le réducteur estampillait
  `isComplete: true` sans qu'aucune nouvelle recherche ne parte. `cancelled`
  vaut désormais « jette la session », pas « fige-la ».
- Divers : `default` manquant dans le réducteur (une variante ajoutée côté Rust
  rendait `setSession(undefined)` puis un `TypeError`) ; objet de retour
  mémoïsé ; hook colocalisé en `components/content-search-palette/` selon le
  test de `docs/react-guidelines.md` ; test tautologique supprimé.

Écarts au plan :

1. **La commande prend `query` seul, pas `query` + `mode`.** L'analyse du
   préfixe `/` vit uniquement dans `parse_content_query`, ce qui supprime aussi
   le piège « littéral multi-token » qui dégradait le AND en OR.
2. **« Refuser de lancer » est devenu une attente bornée avec re-test de
   péremption.** Refuser aurait jeté la requête la plus récente, celle que
   l'utilisateur veut. Mais faire la queue sur `lock()` réintroduit la moitié
   « occupation de thread » du problème que la règle fermait : chaque frappe
   passée le debounce gare un thread de plus dans le pool bloquant de Tauri,
   partagé avec toutes les commandes de `commands/fs.rs` (`max_blocking_threads`
   vaut 512 par défaut chez tokio). D'où la boucle `try_lock` + `sleep(25 ms)` :
   un attendant périmé rend son thread en ~25 ms au lieu de la durée complète
   de son prédécesseur.
3. **Déplacement d'environ 1100 lignes** du cœur de la slice 1 de
   `commands/search.rs` vers `commands/content_search.rs`, vérifié neutre en
   comportement.
4. **Les trois ajouts au contrat légués par la slice 1** ont atterri ainsi :
   `outcome` porte l'état terminal (le frontend ne le déduit jamais de `total`),
   `line_truncated` remonte jusqu'à `ContentSearchResult` en TS, et `batch_size`
   est maintenant sous test de streaming.
5. **`parse_content_query` est appelé dans `run_content_scan`, pas dans la
   commande**, contrairement à la découpe demandée : sinon le chemin « requête
   illisible » reste dans la région intestable et son événement terminal n'est
   couvert par rien.

**Risques résiduels assumés :**

- La garde `AppError::NoWorkspace` reste dans le `#[tauri::command]`, donc hors
  de portée des tests : la supprimer laisse la suite verte. La fermer
  demanderait de descendre la garde dans `run_content_scan` et d'émettre
  `Done(Failed)` au lieu de rejeter l'invoke — un changement de contrat IPC, à
  trancher avant la slice 3.
- L'attente bornée coûte un réveil toutes les 25 ms par attendant. Négligeable
  au regard du scan, mais ce n'est pas une primitive de synchronisation : deux
  attendants ne sont pas servis dans l'ordre d'arrivée. Sans importance ici, le
  plus ancien étant toujours le périmé.
- `outcome: "aborted"` est inatteignable hors extinction de l'app (cf. la
  réserve sur `Channel::send`). Le code du chemin existe et est testé, il ne
  sera simplement jamais déclenché en production.
- `tests/helpers/fake-react.ts` n'est pas React : il rend de façon synchrone et
  ne groupe pas les mises à jour. Suffisant pour des décisions de séquencement,
  inadapté à tout ce qui dépendrait du batching.
- Le nettoyage de l'effet part à chaque frappe ; `cancel_workspace_content_search`
  n'est envoyé que si le debounce avait déclenché, mais un aller-retour IPC de
  plus par recherche abandonnée reste.

## Slice 3 — La palette _(point de livraison naturel)_

À la fin de cette slice la feature est utile et complète : on cherche, on voit,
on ouvre. Le saut à la ligne vient après.

### [D-3] Surface unique — décision produit, prise en cours de slice 3

Le plan prévoyait un composant séparé `content-search-palette.tsx` et deux
palettes distinctes. **Annulé.** Décision de l'utilisateur : une seule zone de
recherche dans le produit. Une palette, qui remonte les noms de fichiers _et_ le
contenu.

La justification du composant séparé (7 conditionnels sur
`commandPaletteIntent`, layout divergent) portait sur l'hypothèse « deux
palettes ». Elle tombe avec l'hypothèse. Ce qui reste vrai et gouverne
maintenant : `docs/consolidation.md` interdit deux sources de vérité pour
« qu'est-ce qui est ouvert », et `command-palette/index.tsx` fait déjà 330
lignes.

Forme retenue :

- `command-palette/index.tsx` reste **la** palette : elle possède le dialog,
  l'input, la sélection et l'état d'ouverture. Aucun second discriminant dans
  `ui-store`, donc la question de l'exclusion mutuelle disparaît — il n'y a plus
  deux choses à exclure.
- Le rendu de chaque groupe part dans un composant enfant du même répertoire. Le
  shell ne doit pas grossir de la taille du rendu des extraits (groupement par
  fichier, lignes multiples, plages surlignées).
- Groupes, dans cet ordre : `Commands`, `Files`, `In documents`. **Pas
  d'interclassement noms/contenu** : scorer un chemin contre un extrait sur une
  échelle commune est un problème ouvert ; le groupement l'évite et reste
  explicable.
- `Cmd+Shift+F` ouvre **la même** palette, comportement identique à `Cmd+P`. Un
  mode « contenu seulement » caché derrière le second raccourci réintroduirait
  deux comportements sous une surface unique. Le préfixe `/` reste le moyen
  explicite de viser le contenu en littéral.
- La barre « Search » de la sidebar (`file-browser.tsx`, réglage
  `appearance.sidebar-show-search`) reste le point d'entrée cliquable unique et
  garde son libellé `⌘P`. Rien n'est ajouté à l'écran.
- **Seuil de 3 caractères avant de lancer le scan de contenu.** Le fuzzy sur les
  noms reste instantané dès le premier caractère ; sans seuil, chaque `Cmd+P`
  pour sauter à un fichier déclencherait un scan disque du workspace.

La spec est amendée en conséquence : elle gelait `Cmd+P` en noms-seulement
(`:28`) et demandait une icône de sidebar dédiée (`:27`). Les deux sont caducs.

**Points à respecter** : `cmdk` avec `shouldFilter={false}` (`index.tsx:252`) ;
**clés composites** `${path}:${line}` — l'existant fait `key={r.path}` (`:299`),
qui collisionne dès plusieurs hits par fichier ; la dérivation de `firstValue`
(`:226-227`) suppose des chemins uniques et doit être refaite pour N groupes.

**Stabilité de l'ordre pendant l'interaction.** Les lots arrivent dans l'ordre de
l'index, les scores non. Le pattern existant resnappe la sélection sur
`firstValue` à chaque changement de résultats (`:237-240`) : un lot qui atterrit
pendant que l'utilisateur a la main peut déplacer la sélection sous son `Enter`.
→ figer l'ordre dès que l'utilisateur navigue au clavier, ne re-trier qu'entre
deux frappes.

**Surlignage** : `HighlightedPath` (`:49-60`) est module-privé et émet **un
`<span>` par caractère** — pathologique pour des dizaines d'extraits. Écrire un
composant frère basé sur des plages, trois spans par match, découpant avec
`Array.from` (cf. [RT-2]).

**Raccourci** — `Cmd+Shift+F` est **libre**, revérifié indépendamment sur les
cinq surfaces de keymap (`use-keyboard-shortcuts.ts`,
`editor-search-extensions.ts:99-113`, `basicSetup.ts:40-47`,
`markdown-formatting.ts:375-396`, `list/index.ts`, `mermaid-canvas.ts:618`) et
l'unique accélérateur natif (`lib.rs:267`). Clause dans le `handleKeyDown`
unique, testant `e.key === "f" || e.key === "F"` : **avec Shift sur macOS
`e.key` est en majuscule** — c'est déjà pourquoi la clause `Cmd+P` teste
`"p" || "P"` (`use-keyboard-shortcuts.ts:51-55`).

**Second point d'entrée** : la spec (`:27`) demande aussi une icône de recherche
dans l'en-tête de sidebar. La faire ici, ou acter le descope dans la spec — ne
pas la laisser tomber en silence.

**Docs** : `docs/keyboard-shortcuts.md` est à la **racine du repo**, pas sous
`apps/desktop`, et se déclare référence canonique.

**Tests** : runner `vite-plus/test`, `environment: "node"`,
`include: ["tests/**/*.test.ts"]` — **pas de `.tsx`, pas de DOM**, donc pas de
rendu de composant. Tester le hook, le groupement, le tri, et le découpage des
plages sur des chaînes accentuées et avec emoji.

**Vérification** : `vp check`, `vp test`, puis lancement réel via le skill
`verify`.

### Résultat — livrée après trois revues et une passe de remédiation

Les trois revues (blue team QA, red team, code review React/UX) ont **toutes
bloqué** le premier jet, sur trois P1 concentrés dans les états terminaux de
`contentSection` et le câblage de `index.tsx` — exactement la région que le
runner ne peut pas atteindre (`environment: "node"`, pas de `.tsx`).

Ce qui a atterri :

- `command-palette/use-content-search.ts` — le hook de la slice 2 déplacé depuis
  `components/content-search-palette/`, répertoire supprimé. Un seul changement
  de comportement : la session est **vidée quand la requête repasse vide**.
- `command-palette/group-content-results.ts` — module pur : seuil de 3
  caractères (`contentSearchQuery`, source unique de la règle), groupement par
  chemin, tri score décroissant puis `relative_path` croissant, valeur cmdk
  composite `${path}:${line_number}`, `contentParentDir`, et `contentSection`
  qui dérive l'état affiché (`idle` / `pending` / `empty` / `unavailable` /
  `active`).
- `command-palette/highlight-ranges.ts` — découpage des plages en points de
  code, trois segments au plus par match, une seule passe.
- `command-palette/content-results.tsx` — rendu du groupe `In documents`
  uniquement. Le shell garde le dialog, l'input, la sélection et l'intention.
- `command-palette/index.tsx` — trois groupes (`Commands`, `Files`,
  `In documents`), `firstValue` étendu aux lignes de contenu, requête de contenu
  gardée par `root`, signal d'indexation autonome, règle de stabilité de la
  sélection.
- `use-keyboard-shortcuts.ts` — clause `Cmd+Shift+F`, testant `"f" || "F"`,
  gardée par `root`.

Défauts corrigés :

- **La palette devenait entièrement blanche pendant la recherche.**
  `CommandEmpty` était gardé sur `idle` seul alors que le groupe de contenu ne
  rend rien en `pending` : 350 ms minimum sans une seule ligne ni un seul
  message, et un clignotement par frappe une fois qu'un scan a rendu zéro
  résultat. Invariant posé : **la liste n'est jamais à la fois vide de lignes et
  vide de messages**, et aucun message n'énonce un verdict qu'aucun scan n'a
  atteint. Le délai de 200 ms ne gouverne plus que l'affordance « Searching… »
  _à côté des résultats_, ce que la spec (`:74`) demandait.
- **Les résultats d'une requête précédente s'affichaient comme courants.**
  `isStale` n'était consulté que sur la branche `empty`. Le débounce redémarre à
  chaque frappe, donc la fenêtre n'était pas bornée à 150 ms : en frappe rapide
  le corpus périmé restait à l'écran toute la rafale, `firstValue` retombait sur
  une de ses lignes et **`Enter` ouvrait un fichier répondant à une requête déjà
  effacée**. `isStale` garde maintenant `active`. Deuxième moitié dans le hook :
  la session n'était jamais vidée quand `hasQuery` retombait faux (le reset
  `outcome: "cancelled"` est inatteignable, `channelRef.current` valant déjà
  `null`), donc une nouvelle requête repartait du cadavre de l'ancienne.
- **Un scan en échec était rendu comme le verdict « No matches in documents ».**
  `contentSection` ne lisait jamais `stats.outcome`, le seul champ qui existe
  pour distinguer les deux. Dans une fenêtre sans workspace, `root` est `null`
  mais `isCompactFileMode` est faux, et `contentQuery` n'était pas gardé sur
  `root` : chaque requête de 3 caractères tirait une IPC qui rejette toujours en
  `NoWorkspace`, et la palette affirmait l'absence de matches dans des documents
  jamais ouverts. Corrigé des deux côtés — garde `root` au point d'appel unique,
  et un `kind: "unavailable"` propre pour `failed` / `aborted` / tout ce qui
  n'est pas `completed`.
- **`Cmd+Shift+F` n'était pas identique à `Cmd+P`** alors que `[D-3]` et deux
  docs l'affirmaient : la clause n'avait aucune garde. Gardée sur `root`, ce qui
  ferme aussi le déclencheur du défaut précédent. La même phrase de
  `docs/keyboard-shortcuts.md` prétendait aussi que `Cmd+O` et `Cmd+N` marchent
  en fenêtre compacte, ce qui est faux depuis toujours : corrigé.
- **Le signal d'indexation disparaissait pendant l'indexation.** Le suffixe
  `Files (indexing...)` était porté par un groupe vide précisément tant que
  l'index se construit. Le signal est sorti de l'en-tête et devient une ligne à
  part entière, atteignable que le groupe `Files` soit peuplé ou non.
- **Un fichier à la racine du vault affichait `/` comme parent.**
  `getParentDir` était appelé sur un chemin **relatif** ; tous les autres
  appelants du repo lui passent un absolu. `contentParentDir` rend `""`.
- Divers : assertion sur `truncated` avant l'arrivée des stats, clamp bas et
  clamp de plage inversée testés, commentaires qui redisaient la ligne suivante
  supprimés.

Écarts au plan :

1. **Le gel de l'ordre est supprimé, remplacé par la stabilité de la
   sélection.** Le plan demandait de « figer l'ordre dès que l'utilisateur
   navigue au clavier ». Trois constats l'ont invalidé. (a) Une flèche pressée
   avant le premier lot stockait `paths: []`, qui est **truthy** : le tri par
   score était désactivé pour toute la session, et la garde `if (frozenPaths)`
   empêchait ensuite tout vrai gel de le remplacer. (b) Le gel ne couvrait pas
   le flux qu'il visait — taper, attendre, `Enter` sans jamais toucher une
   flèche : aucun gel, un lot tardif re-trie, l'effet de snap re-sélectionne la
   nouvelle tête et `Enter` ouvre un autre fichier. Idem au survol souris, et
   `firstValue` dépend aussi de `visibleFiles[0]`, qu'aucun gel de contenu ne
   contrôle. (c) `frozenPathsFor` étant clefé sur le **texte** de la requête et
   `CommandPalette` ne se démontant jamais, un gel ressuscitait en revenant sur
   une requête déjà effacée. Le mal nommé par le plan est le **déplacement de la
   sélection**, pas le re-tri : cmdk indexe sa sélection sur `value`, donc ne
   plus resnapper suffit à la fermer complètement. `orderContentGroups` trie
   toujours par score ; l'effet de sélection ne resnappe que si la requête ou
   l'intention change, ou si la valeur sélectionnée a quitté la liste.
2. **Le groupe unique `Results` / `Suggested` est scindé** en `Commands` et
   `Files`, comme l'exige l'ordre de groupes décidé en `[D-3]`.
3. **Descope acté dans la spec** pour l'icône de recherche en en-tête de
   sidebar : la barre `Search ⌘P` existante reste le point d'entrée cliquable
   unique.
4. **Deux descopes supplémentaires actés dans la spec**, plutôt que laissés
   tomber en silence : les **en-têtes de fichier collants** (`:55`) et le
   **rappel fuzzy vs. grep sur requête vide** (`:95`). Motifs dans la spec.

**Risques résiduels assumés :**

- Rien du rendu n'est testé : `include: ["tests/**/*.test.ts"]` et
  `environment: "node"` interdisent le `.tsx`. Toute la logique décidable est
  sortie dans les modules purs, mais le câblage de `index.tsx` — garde `root`,
  garde de `CommandEmpty`, et surtout **la règle de stabilité de la sélection**
  — n'a pas de filet. Les quatre mutations correspondantes survivent, vérifié.
  Extraire le prédicat de snap en fonction pure ne fermerait pas la brèche (le
  test porterait sur `a !== b || !c`, tautologique) et ne dirait rien de
  l'effet, qui est la partie fragile.
- **Le re-tri visuel à l'arrivée des lots est assumé.** Les groupes bougent sous
  les yeux de l'utilisateur ; sa sélection, elle, ne bouge plus. Si le
  mouvement s'avère pénible à la vérification runtime, le corriger par une
  fenêtre de stabilité d'affichage, **pas** en réintroduisant un gel.
- `line_truncated` rend une seule ellipse, en fin de ligne. La fenêtre de
  `snippet_window` coupe presque toujours la queue, mais quand le match est dans
  les 400 derniers caractères c'est la tête qui est coupée : le frontend ne
  reçoit pas l'information et l'ellipse est alors du mauvais côté.
- **Les plages de surlignage ne s'alignent pas sur les graphèmes.** Sur du texte
  NFD (`café` = `e` + U+0301), un match littéral de `cafe` rend `[0,4]` et
  l'accent combinant part dans le `<span>` suivant, où il s'affiche seul ou sur
  un cercle pointé. Le correctif tient en quinze lignes avec `Intl.Segmenter`,
  mais il demande d'ajouter `ES2022.Intl` au `lib` du `tsconfig` **et** une
  garde d'existence : `tauri.conf.json` déclare `minimumSystemVersion: 10.15`,
  dont la WKWebView (Safari 13) n'a pas `Intl.Segmenter`, et un
  `new Intl.Segmenter` au niveau module y ferait lever l'import de toute la
  palette. Accepté en l'état, à reprendre si le plancher macOS monte.
- Les lignes d'un groupe continuent de grossir : un lot peut ajouter des lignes
  dans un groupe déjà affiché, donc décaler ce qui est **sous** lui.

**Vérification** (depuis `apps/desktop/`, `apps/desktop/src-tauri/`) :

```
../../node_modules/.bin/vp check   → 0 errors, 1 warning (e2e/wdio.conf.js, préexistant)
../../node_modules/.bin/vp test    → 49 fichiers, 620 tests passés (617 avant remédiation)
cargo test                         → 205 passés, 0 échec (inchangé)
```

Auto-contrôle par mutation, huit mutations, **quatre attrapées** ; les quatre
survivantes sont toutes dans `index.tsx`, hors de portée du runner :

| Mutation                                       | Résultat       | Test qui tombe                                      |
| ---------------------------------------------- | -------------- | --------------------------------------------------- |
| `isStale` ne garde plus `active`               | attrapée       | `a previous query's results are never shown…` (+1)  |
| `contentSection` ignore `outcome`              | attrapée       | `a scan that never read the documents…`             |
| le hook ne vide plus la session                | attrapée       | `a new query never starts from the previous one's…` |
| comparateur de tri inversé                     | attrapée       | `sorts by score descending` (+2)                    |
| `CommandEmpty` revient à `idle` seul           | **survivante** | rendu non testable (`.tsx`)                         |
| l'effet de sélection resnappe sur `firstValue` | **survivante** | rendu non testable (`.tsx`)                         |
| `contentQuery` n'est plus gardé sur `root`     | **survivante** | rendu non testable (`.tsx`)                         |
| `getParentDir` rendu sans garde à la racine    | **survivante** | `contentParentDir` reste testé, son usage non       |

**Vérification runtime — faite.** Les quatre mutations survivantes vivent toutes
dans la couche de rendu ; le runtime est leur seul filet, et le plan l'exigeait.
Spec e2e `apps/desktop/e2e/specs/content-search.spec.js` (auto-amorçant : il
sème son propre workspace dans `os.tmpdir()`), 6 scénarios, **6 passés** :

```
pnpm exec wdio run ./wdio.conf.js --spec ./specs/content-search.spec.js
  ✓ never renders a blank list while a content scan is pending
  ✓ groups matches by file with highlighted text and line numbers
  ✓ never shows a root-level file with a bare / as its parent
  ✓ never attributes a previous query's results to a new one
  ✓ keeps the selection put while further batches land
  ✓ does not open the palette or claim zero matches without a workspace
6 passing (3.7s)
```

Chaque scénario cible une mutation survivante : le premier couvre le garde
`CommandEmpty`, le cinquième la règle de resnap, le sixième le gate `root` sur
`contentQuery`, le troisième le garde JSX du répertoire parent. La couche de
rendu n'est donc plus sans filet, elle l'est seulement sans filet _unitaire_.

Confirmé visuellement sur la capture : sur `Un émoji 🎉 avant throughput`, le
surlignage tombe exactement sur le token. C'est `[RT-2]` prouvé à l'exécution —
avec `String.prototype.slice`, l'emoji comptant 2 unités UTF-16, il serait
décalé de deux caractères.

Pièges du harnais rencontrés, notés ici pour la prochaine slice qui devra
relancer le runtime :

- Le `beforeBuildCommand` de Tauri appelle `vp build`, absent du `PATH` d'un
  shell frais : le build meurt en 127 avant de compiler quoi que ce soit.
  Préfixer par `export PATH="<repo>/node_modules/.bin:$PATH"`.
- `cargo tauri` demande le CLI : `cargo install tauri-cli --version "^2" --locked`.
- L'input de cmdk est contrôlé par React : une affectation directe de `value`
  n'atteint pas le store, seuls de vrais événements clavier y arrivent.
  `addValue` tape, et `Backspace` efface — `clear` lève sur un input vide.
- Pour une assertion qui dépend de l'état frontend, utiliser les commandes de
  l'app, pas l'IPC brut : `close_workspace` n'est que la moitié Rust et laisse
  `root` posé dans le store. C'est ce qui a fait échouer le scénario 6 au
  premier passage — le test était faux, pas le code.
- `backdrop-filter` n'est pas composité dans `saveScreenshot` : les surfaces
  translucides laissent voir la page derrière, nette. Du contenu qui semble
  chevaucher la palette n'est en général que le fond non flouté.

## Slice 4 — Porteur de cible et correctifs de navigation

Aucun saut à la ligne encore : cette slice remet d'aplomb le chemin existant,
qui a **zéro test** aujourd'hui.

**Généraliser `pending-anchor.ts`** (15 lignes, `Map<string,string>`) en cible
taguée : `{kind:"heading", slug} | {kind:"line", line}`. Une seconde map
parallèle pourrait se déclencher en même temps que la première.
`docs/consolidation.md:68` (« funnel writes through one path ») tranche : un
porteur, un point de consommation.

**Accès à la vue vivante pour le cas même-fichier.** `editor-api.ts` n'expose
**aucun** accesseur de vue (vérifié). Mais le mécanisme n'est pas à inventer :
`editor-pane.tsx:30` détient déjà la vue via `onViewChange`, et
`editor-search-store.ts:41-47` est le précédent d'un composant React
non-CodeMirror qui pilote la vue vivante par un store. Suivre ce précédent — un
registre de vue active alimenté par `onViewChange`.

**Les trois correctifs :**

1. **Même fichier** — le cas le plus courant, aujourd'hui une impasse.
   `link-navigation.ts:49-52` court-circuite quand `target.path === filePath`
   parce que `navigateToFile` sort tôt sur chemin identique
   (`editor-store.ts:657`) : l'effet `[filePath, reloadVersion]` ne part jamais,
   la valeur en attente resterait puis se déclencherait à tort à la navigation
   suivante. Branche explicite qui scrolle la vue vivante.
2. **Premier montage** — l'effet de montage (`use-prosemark-editor.ts:131-140`)
   appelle `restoreScrollPosition` et ne consulte jamais la valeur en attente.
   Ouvrir un résultat dans une fenêtre fraîche tombe dessus.
3. **Pollution de `scrollPos`** — le listener (`:135-139`) écrit chaque scroll
   via `updateScrollPos` : un saut programmatique **écrase la position
   sauvegardée**, persistée en session. **La condition de levée est le vrai
   travail**, pas le drapeau : lever de façon synchrone ne sert à rien
   (l'événement de scroll du saut arrive après), et lever sur minuterie avale un
   scroll utilisateur légitime fait pendant la fenêtre. → lever à la première
   notification de scroll dont le `scrollTop` correspond à la cible, puis
   réarmer.

**Fuite sur navigation échouée** — cliquer un résultat d'un fichier que le
watcher vient de voir disparaître : `setPendingTarget` puis `ensureFileLoaded`
lève, l'onglet revient en arrière (`editor-store.ts:686-706`), l'entrée n'est
jamais consommée et se déclenchera plus tard sans raison. Le bug existe déjà
pour les ancres ; la recherche le rend fréquent. → nettoyage sur échec.

**Point d'insertion** : le `if/else` de `use-prosemark-editor.ts:192-206`, jamais
un effet parallèle. Ancre et `restoreScrollPosition` y sont exclusifs par
construction ; un second `requestAnimationFrame` courserait le restore.

**Tests** : porteur (set/consume, exclusion, pas de fuite, nettoyage sur échec)
et registre de vue. Le comportement de scroll se vérifie à l'exécution — pas
d'`EditorView` en `environment: "node"`.

### Résultat — livrée après trois revues et une passe de remédiation

Les trois revues (blue team QA, red team, code review Editor/React) ont **toutes
bloqué** le premier jet, et convergeaient sur le correctif #3 : le mécanisme de
suppression de scroll était à la fois inopérant sur le chemin visé et porteur de
deux régressions pires que le bug qu'il fermait. 9 mutations sur 26 survivaient,
dont cinq dans du TypeScript pur testable en `node`.

Ce qui a atterri :

- `lib/pending-target.ts` — le porteur généralisé en cible taguée
  (`heading` | `line`), un seul point de consommation, plus
  `clearPendingTarget` / `clearAllPendingTargets`.
- `editor-view-registry.ts` — la vue vivante de chaque panneau **actif**, clefée
  par chemin, avec contrôle d'identité au désenregistrement (les onglets fichier
  sont `keepAlive`, donc plusieurs panneaux montés peuvent porter le même
  chemin).
- `use-register-editor-view.ts` — l'effet d'enregistrement sorti d'`editor-pane.tsx`
  (`docs/react-guidelines.md` : pas de `useEffect` en composant), sur le modèle
  de `useCloseEditorSearchWhenInactive`.
- `link-navigation.ts` — `navigateToTarget` (branche même-fichier vers la vue
  vivante), `targetDocPos` (seul décodeur de `kind`), `applyRegisteredViewTarget`.
- `editor-scroll.ts` — `jumpScrollTop` / `jumpToPos`, le seul endroit où un saut
  programmatique persiste sa position d'arrivée.

**[D-4] La suppression de scroll est remplacée par une ré-écriture explicite.**
Écart au correctif #3 tel que rédigé, sur trois constats :

1. **La prémisse du plan est fausse.** Une position écrasée par un saut n'est
   **pas** persistée en session : `getEditorSessionSnapshot` ne sérialise que
   `location`, `back` et `forward`. `scrollPos` est en mémoire, par exécution.
   Le préjudice réel est borné à « changer d'onglet et revenir dans la même
   session ». La machinerie qui le défendait n'était pas proportionnée.
2. **La condition de levée était falsifiable par construction.** Lever à la
   notification dont le `scrollTop` égale la valeur relue après le saut suppose
   que cette valeur arrive. Les événements de scroll sont coalescés à un par
   frame, rapportant l'offset **final** : tout ce qui bouge le scroller dans la
   même frame fait qu'elle n'arrive jamais. Or `docs/editor.md:138` documente
   que l'ancrage de la boucle de mesure de CodeMirror ajuste le scroller
   ancêtre quand l'éditeur a le focus — et le flux d'ancre inter-fichiers
   appelle `view.focus()` avant le rAF. Conséquences : la position du saut était
   persistée quand même, **et** la suppression restait armée indéfiniment, par
   panneau, à travers un changement de document.
3. **Le chemin phare de la slice n'armait rien.** `scrollLiveView` vit dans un
   module non-hook, hors de portée du `ref` local qui portait la suppression :
   le correctif #3 n'était pas appliqué au cas que le plan qualifie de « plus
   courant », et son `"smooth"` produisait 20-30 écritures distinctes.

À la place, tout saut programmatique scrolle en `"auto"`, relit `scrollTop` sur
le conteneur et l'écrit lui-même via `updateScrollPos`. Ce que l'écouteur a
persisté entre-temps est corrigé par cette écriture ; le store court-circuite
sur valeur égale, donc la notification du saut est un no-op. Aucun état armé, donc
rien ne peut rester coincé, traverser un changement de document, ni avaler un
scroll légitime — et ça marche identiquement dedans et dehors du hook, ce qui est
la seule façon de corriger le chemin `scrollLiveView`. Appliqué aux quatre sites :
montage, swap, `scrollLiveView`, restauration.

Autres défauts corrigés :

- **Le swap écrivait l'offset du fichier sortant dans le fichier entrant.**
  Quand le panneau ne se démonte pas, `view.dispatch` remplace le document de
  façon synchrone, le `scrollTop` du conteneur est clampé, et l'événement de
  scroll part **avant** les callbacks d'animation frame. L'ancienne branche
  `pos !== null` sortait sans jamais restaurer, donc plus rien ne réparait. La
  ré-écriture explicite ferme le cas.
- **Une vue détruite pouvait être rendue par le registre.**
  `use-prosemark-editor.ts` détruit la vue avant que `onViewChange(null)` ne
  déclenche le désenregistrement. Dans cette fenêtre, `findOuterScroller` sur un
  nœud détaché rend `null` et la navigation était un no-op silencieux.
  `scrollLiveView` rend maintenant un booléen et le porteur reprend la main.
- **Fenêtre de fuite ouverte par la garde `isActive`.** Le store pose
  `activeFilePath` de façon synchrone dans `set()`, l'effet d'enregistrement
  passe plus tard : entre les deux, `getEditorView` rend `undefined` alors que
  le panneau est déjà monté sur ce chemin, donc ni le montage ni le swap ne
  consomment la cible. L'enregistrement consomme désormais la cible en attente.
  Inatteignable en slice 4, atteignable en slice 5 depuis la palette.
- **Le rAF du saut capturait `pos` sans le document contre lequel il avait été
  calculé.** `isDisposed()` ne couvre que le démontage ; un rechargement piloté
  par le watcher n'est pas cadencé par l'utilisateur. La garde teste maintenant
  chemin **et** version de rechargement.
- **`targetDocPos` prenait une `string`.** La slice 5 a besoin de
  `doc.line(n).from` clampé à `doc.lines`, indérivable d'une chaîne sans
  ré-implémenter `DefaultSplit` — la désynchronisation déjà rencontrée et
  corrigée côté Rust en slice 1. La signature prend la `Text` maintenant, pour
  que la slice 5 bascule un `case` au lieu de défaire une signature.
- **Le porteur n'était jamais nettoyé sur renommage, suppression ou changement
  de workspace.** Branché sur les quatre actions du store qui appellent déjà
  `cancelSave`, plus les trois remises à zéro de `workspace-store`.
- **Les tests ne certifiaient rien.** La branche vue-vivante n'avait aucune
  assertion de comportement (remplacer son corps par un `return` laissait la
  suite verte), `followLink` — le point d'entrée réécrit par la slice — zéro
  couverture, et le placeholder `case "line"` n'était épinglé nulle part. Les
  sept mutations du tableau ci-dessous sont maintenant fermées. Le
  désenregistrement a aussi migré du corps de test vers `afterEach` : une
  assertion qui lève avant laissait la vue dans le registre pour le test
  suivant.
- `findHeadingBySlug` n'est plus exporté (son seul appelant est deux lignes plus
  bas), et `editor-notice-store.ts` utilise les globales de timer plutôt que
  `window.*`, ce qui le rend observable sous `environment: "node"` — sans quoi
  l'assertion sur la notice n'est pas écrivable.

Écart de conception assumé : **le registre est une `Map` de module, pas un store
Zustand**, contrairement au précédent `editor-search-store` cité par le plan.
Rien ne s'y abonne ; un store ajouterait une surface de rendu pour rien.

**Risques résiduels assumés :**

- Tout ce qui touche au DOM reste hors couverture unitaire : la valeur de
  `scrollTop` après un vrai layout, l'ordre réel entre l'événement de scroll du
  swap et le rAF, et l'effet d'enregistrement lui-même. Les fakes de test
  prouvent le clamp et la ré-écriture, pas le timing du navigateur.
- La ré-écriture persiste la position **clampée** quand le conteneur ne peut pas
  atteindre celle demandée. C'est cohérent (la sauvegarde reflète où le
  conteneur est), mais si le clamp est transitoire — hauteurs pas encore
  stabilisées — la position sauvegardée est perdue. Non observé.
- `section-rail.tsx` scrolle toujours via `scrollPosToSafeTop` direct, sans
  ré-écriture : le clic sur le rail persiste la position d'arrivée par
  l'écouteur, ce qui est le comportement voulu ici (l'utilisateur navigue dans
  le document) mais n'est pas garanti par la même règle.
- La couche de rendu reste sans filet unitaire (`environment: "node"`, pas de
  `.tsx`) : `editor-pane.tsx` câble le hook d'enregistrement, rien ne le teste.

**Vérification** (depuis `apps/desktop/`, `apps/desktop/src-tauri/`) :

```
../../node_modules/.bin/vp check   → 0 errors, 1 warning (e2e/wdio.conf.js, préexistant)
../../node_modules/.bin/vp test    → 53 fichiers, 656 tests passés (648 avant)
cargo test                         → 205 passés, 0 échec (inchangé)
```

Auto-contrôle par mutation, sept mutations, **sept attrapées** :

| Mutation                                                   | Résultat | Test qui tombe                                                       |
| ---------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| corps de `scrollLiveView` → `return true`                  | attrapée | `the file on screen reports a heading it doesn't contain…` (+3)      |
| `same-doc-anchor` routé vers `setPendingTarget`            | attrapée | `a same-document anchor goes to the live view, never onto…`          |
| `followLink` perd l'ancre d'un lien interne inter-fichiers | attrapée | `carries the anchor of a cross-file internal link`                   |
| `targetDocPos` rend `target.line` pour une cible ligne     | attrapée | `a line target resolves to nothing until slice 5 converts it`        |
| le saut n'écrit plus sa position d'arrivée                 | attrapée | `records the clamped landing position, not the one it aimed at` (+3) |
| l'enregistrement ne consomme plus la cible en attente      | attrapée | `consumes a target left for the path while the view was still…`      |
| `scrollLiveView` ne retombe plus sur `setPendingTarget`    | attrapée | `a view that cannot scroll hands the target back to the carrier`     |

## Slice 5 — Saut à la ligne

Conversion : `view.state.doc.line(n).from`, avec `n` **clampé à `doc.lines`** (le
fichier a pu changer entre le scan et le clic), puis `scrollPosToSafeTop`
(`editor-scroll.ts:19`), qui passe par `lineBlockAt` + `documentTop` précisément
pour fonctionner hors du viewport rendu.

**Dérive après parse — le piège non évident.** `lineBlockAt` interroge la
heightmap ; dans une région non parsée les hauteurs sont **estimées**. Après le
scroll, `viewportParsePlugin` force le parse, les décorations (images, tables,
folds) se matérialisent et les hauteurs changent. `docs/editor.md:138` précise
que la compensation habituelle de CodeMirror ne tourne **que si l'éditeur a le
focus ou qu'un événement wheel/touch date de moins de 100ms** — or un clic dans
la palette laisse le focus dans l'input cmdk et ne produit aucun wheel. La
compensation est donc désactivée exactement dans ce flux. → forcer le parse de la
région cible _avant_ de scroller, ou re-scroller après le commit de mesure.

**Vérification** : runtime obligatoire via le skill `verify`, sur un document de
plusieurs milliers de lignes contenant images et tables, plus un fichier avec
frontmatter, plus un résultat **dans le fichier déjà ouvert**. Confirmer aussi
que la position de scroll sauvegardée survit au saut.

### Résultat — livrée après trois revues et une passe de remédiation

Les trois revues (blue team QA, red team, code review Editor/React) ont **toutes
bloqué** le premier jet, et cette fois sur trois défauts **disjoints** : aucune
n'a trouvé ce qu'une autre avait trouvé. Les trois portaient sur la même
fonction neuve, `correctDrift`, par trois angles différents — identité du
document, précondition non encodée, arguments non certifiés.

Ce qui a atterri :

- `link-navigation.ts` — `targetDocPos` convertit `kind:"line"` en
  `doc.line(n).from`, `n` clampé à `[1, doc.lines]`.
- `editor-scroll.ts` — `safeTopFor` extrait en fonction pure ; `jumpToPos`
  parse la région cible, scrolle, écrit sa position d'arrivée (`[D-4]`), puis
  corrige la dérive sous trois gardes.
- `viewport-parse.ts` — `parseThrough(view, pos)`, point unique où une cible de
  parse se dérive d'une position. Les deux constantes redeviennent privées.
- `content-results.tsx` / `index.tsx` — la ligne de contenu route vers
  `navigateToTarget(path, { kind:"line", line })`.

Défauts corrigés :

- **`correctDrift` s'exécutait contre un document qui n'était plus celui visé.**
  Sa seule garde, `at !== landedAt`, protège l'identité du _scroller_, pas celle
  du _document_. Un swap d'onglet ou un rechargement watcher entre le saut et la
  passe de mesure laisse typiquement `scrollTop` intact — le navigateur ne
  reclampe que si le document entrant est plus court — donc la garde passait, la
  correction mesurait un `pos` périmé contre le nouveau document, et écrivait
  `updateScrollPos` sur le chemin **sortant**. Sur la branche `reloaded` de
  `use-prosemark-editor.ts`, rien ne répare : elle n'appelle pas
  `applyPendingTarget`. Exactement la famille fermée en slice 4 au niveau du
  rAF, rouverte une couche plus bas. `view.state.doc` est un `Text` immuable,
  donc l'égalité de référence est le test exact ; elle est exigée dans `read`
  **et** dans `write`, chacune séparément observable (CodeMirror lit toutes les
  requêtes en attente avant d'en écrire une seule).
- **Double compensation sur le chemin focalisé.** Le commentaire énonçait la
  précondition — CM ne ré-ancre que si l'éditeur a le focus ou qu'un wheel/touch
  date de moins de 100 ms — mais le code ne la testait jamais. Or `jumpToPos`
  est aussi le chemin des ancres de heading, atteint depuis un clic _dans_
  l'éditeur. L'ancrage de CM tourne **après** que nos requêtes se soient
  drainées, sans voir notre écriture : les deux compensations s'additionnaient
  et la cible atterrissait sous la zone sûre. `at !== landedAt` ne pouvait pas
  l'attraper, CM bougeant le scroller _après_ la correction. La précondition est
  maintenant une garde `view.hasFocus`.
- **Les arguments de `forceParsing` n'étaient certifiés par rien.** Deux
  mutations survivaient, dont l'**inversion du signe de l'overshoot** — qui fait
  parser jusqu'à 2000 caractères _avant_ la cible et annule l'objet de la slice.
  Cause racine : le fake déclarait `state.field: () => undefined`, donc
  `ensureSyntaxTree` court-circuitait à `null` et `forceParsing` dispatchait par
  sa branche d'**échec**. La sonde n'observait qu'« un dispatch quelconque a
  précédé la première mesure » — ni qu'un parse avait eu lieu, ni quelle région,
  ni quel budget. En production, avec un `Language.state` à jour, `forceParsing`
  ne dispatche pas et l'assertion aurait été fausse. Le fake était complaisant
  et son commentaire décrivait le contrat réel plutôt que ce qu'il modélisait.
- **Deux règles d'ouverture d'onglet pour deux lignes de la même liste.** Le
  câblage substituait `navigateToFile` à `openFile` pour les lignes de contenu.
  Les deux ne coïncident que si l'onglet actif est de kind `file` ou `launcher` :
  avec l'onglet Réglages actif, une ligne de contenu le remplaçait en place, une
  ligne de fichier ouvrait à côté. Changement de sémantique que la slice ne
  demandait pas. `navigateToTarget` ouvre désormais par `openFile`, neutre pour
  `followLink` — vérifié dans le code, pas supposé : `EditorArea` rend les
  panneaux non actifs en `pointer-events-none`, donc un clic de lien ne peut
  venir que du panneau actif, dont l'onglet est de kind `file`.
- Divers : bande morte d'un pixel sur la correction (`scrollTop` est
  fractionnaire en HiDPI, l'égalité exacte n'arrive jamais — CM trace la même
  bande) ; les trois clamps de `safeTopFor` ne tombaient sous aucun test, les
  fakes les masquant ; deux fakes du même scroller avec deux contrats de clamp
  différents ; redite de signature dans le commentaire de la palette.

Écarts au plan :

1. **`VIEWPORT_OVERSHOOT` n'est plus exporté ; `parseThrough` l'est.** Le
   premier jet exportait deux constantes pour que `jumpToPos` re-dérive
   l'expression « parser jusqu'à X + overshoot, sous budget », déjà écrite à
   trois endroits. La constante portait aussi deux sens — « au-delà de
   `viewport.to` » et « au-delà de la cible du saut » — pour la seule raison que
   la valeur coïncide. Un point unique, testé, ferme les deux.
2. **`editor-api.ts` gagne un accesseur `openFile`.** `link-navigation.ts`
   n'atteint le store que par ce module ; importer `useEditorStore` directement
   aurait ouvert un second chemin d'accès.
3. **Un mutant de `safeTopFor` est refusé comme équivalent, pas fermé.**
   Supprimer le plancher zéro de `max` ne change aucune sortie : quand
   `scrollHeight < clientHeight`, `Math.min(scrollTop + delta, max)` est négatif
   et le `Math.max(0, …)` englobant rend `0` dans les deux cas. Aucun test ne
   doit prétendre le tuer.
4. **`targetDocPos` ne normalise pas les non-entiers.** `Math.max(NaN, 1)` rend
   `NaN` et traverse les deux clamps ; `doc.line(NaN)` lève un `TypeError` brut.
   Inatteignable — tout producteur est un `u32` Rust. Le commentaire a été
   restreint à ce qu'il couvre réellement plutôt que d'ajouter une branche que
   rien dans ce lot ne peut atteindre ni tester.

**Risques résiduels assumés :**

- **La garde de focus n'est pas vérifiable au runtime.** `view.hasFocus` exige
  `document.hasFocus()`, faux pour une fenêtre pilotée par WebDriver, et
  `plugin:window|set_focus` est refusé par l'ACL de capacités de l'app. La
  sortie anticipée de `correctDrift` n'est donc empruntée dans aucun scénario :
  le chemin focalisé est prouvé atterrir correctement, pas prouvé atterrir _sans
  correction_.
- **`parseThrough` au site du saut n'a pas de filet runtime.** Le supprimer
  laisse les 12 scénarios verts, parce que `correctDrift` re-vise et tourne
  toujours dans le flux observable. Ce n'est pas du code mort : c'est la seule
  compensation qui reste sur le chemin focalisé, où la correction est désormais
  coupée — donc précisément le chemin que le runtime ne peut pas atteindre. Le
  test unitaire épingle l'appel et ses arguments ; sa _nécessité_ à ce site
  repose sur la lecture du source de CodeMirror.
- La moitié « wheel/touch de moins de 100 ms » du prédicat d'ancrage de CM n'a
  pas d'accesseur public : un saut non focalisé juste après une molette
  double-compense encore.
- `view.hasFocus` est relu à chaque planification, pas dans `read` : une vue qui
  prend le focus entre la dernière planification et la mesure reçoit une
  correction de trop.
- `section-rail.tsx` scrolle toujours par `scrollPosToSafeTop` direct — ni parse
  forcé, ni correction, ni ré-écriture (l'écart de ré-écriture était déjà acté
  en slice 4). Or un clic sur le rail est exactement le saut lointain non
  focalisé que la correction vise. `docs/editor.md` le nomme désormais comme
  l'exception.
- `EditorScrollContainer` n'a pas `overflow-anchor: none`. Si l'ancrage de scroll
  de Chromium ré-ajuste `scrollTop` entre notre `scrollTo` et la lecture, la
  garde `at !== landedAt` fait abandonner la correction dans le scénario même
  pour lequel elle est écrite. Soupçonné, non observé.
- Les tests unitaires ne modélisent pas la boucle de mesure de CM au-delà du
  « lire tout, puis écrire tout » : ni son abandon à la cinquième itération, ni
  son entrelacement avec `update`.

**Vérification** (depuis `apps/desktop/`) :

```
../../node_modules/.bin/vp check   → exit 0 — 0 errors, 1 warning (e2e/wdio.conf.js, préexistant)
../../node_modules/.bin/vp test    → exit 0 — 54 fichiers, 675 tests passés (664 avant remédiation, 656 avant la slice)
```

Auto-contrôle par mutation après remédiation, 20 mutations, **19 attrapées, 1
refusée comme équivalente** (le plancher zéro ci-dessus). Les deux mutations que
la blue team avait mesurées survivantes — overshoot supprimé, signe inversé —
tombent désormais sur `parses past the position, not up to it`.

**Vérification runtime — faite.** `apps/desktop/e2e/specs/content-search.spec.js`
passe de 6 à **12 scénarios, 12 passés**, stables sur cinq exécutions
consécutives (7,7–7,9 s) :

```
✓ jumps to the clicked line deep inside a document of images and tables
✓ closes the palette once a content result is chosen
✓ scrolls the document already on screen without reopening it
✓ lands on the body line of a document with frontmatter
✓ restores the landing position, not the one from before the jump
✓ still follows an in-editor anchor link over an image-heavy region
12 passing (7.8s)
```

Fixtures semées : un document de 3 247 lignes portant 360 images bloc et 360
tables, son jumeau pour le cas ancre, et un document de 609 lignes derrière sept
lignes de frontmatter. Les assertions portent sur la ligne marqueur rendue et sa
distance à `scrollerTop + EDITOR_SAFE_SCROLL_MARGIN`, avec une tolérance dérivée
à l'exécution de la hauteur de cette ligne — pas sur des pixels figés. Le cas
frontmatter épingle `[RT-1]` de bout en bout : la ligne existe au rang **303 du
corps**, pas 310 du fichier, et la tolérance d'une ligne et demie ne laisse pas
passer un décalage de sept.

Tableau rouge/vert, chaque mutation appliquée à l'arbre sain, rebuild, exécution,
restauration :

| Mutation                                         | Résultat       | Scénarios qui tombent                           |
| ------------------------------------------------ | -------------- | ----------------------------------------------- |
| `line: result.line_number` → `line: 1`           | attrapée       | saut profond, vue vivante, frontmatter, restore |
| `correctDrift` retiré de `jumpToPos`             | attrapée       | saut profond                                    |
| `scrollPos: file?.scrollPos ?? 0` → `0`          | attrapée       | restore                                         |
| `close()` retiré du handler de contenu           | attrapée       | fermeture de la palette                         |
| branche vue vivante de `navigateToTarget` coupée | attrapée       | vue vivante, lien d'ancre                       |
| `parseThrough` retiré de `jumpToPos`             | **survivante** | aucun — voir risques résiduels                  |

Trois pièges du harnais, tous producteurs de verdicts faux, corrigés dans la
spec — à connaître avant de relancer :

- **Un processus de l'app resté d'une session précédente** écoutait encore le
  port du plugin WebDriver ; `tauri-webdriver` s'y attachait, donc la suite
  exerçait le frontend **de la slice 4** en paraissant verte. Diagnostiqué par
  une sentinelle au niveau module qui se relisait `MISSING`. Les exécutions
  commencent maintenant par `pkill -f "target/release/desktop"`.
- **WebKit suspend `requestAnimationFrame` quand la fenêtre est occultée.**
  Chaque saut est ordonnancé dans un rAF (`applyPendingTarget`) : derrière une
  autre fenêtre, l'éditeur ne scrolle jamais et rien ne lève. La spec lève la
  fenêtre et prouve que les frames tournent, en `before` et en `beforeEach`.
- **La spec de la slice 3 n'était pas rejouable** : son dernier scénario ferme
  le workspace, et l'IPC brut `open_workspace` du `before` ne pose que l'état
  Rust. Corrigé par un rechargement après l'IPC.
- Après une passe de mutation, **rebuild** : restaurer les sources ne réinstalle
  pas le bundle, et le dernier mutant reste en place.
- `cargo tauri build` refuse désormais de construire — `tauri` 2.11.2 contre
  `@tauri-apps/api` 2.10.1, que tauri-cli 2.11.4 traite en erreur. Construit avec
  `--ignore-version-mismatches` plutôt que de toucher le lockfile ; le script
  `build:app` de `e2e/package.json` échouera tant que les paquets npm ne sont pas
  montés ou le drapeau ajouté.

## Slice 6 — Flash bref

Rien à réutiliser : `StateEffect` + `StateField` de `Decoration.mark` avec
nettoyage par `setTimeout`, plus une classe CSS. Noter qu'il n'existe **aucune**
règle CSS pour `.cm-searchMatch` dans le repo (le Cmd+F utilise le défaut
CodeMirror). Forme de dispatch à suivre : `jumpToMatch`
(`editor-search-store.ts:117-125`) ; son `userEvent: "select.search"` est
porteur, `searchScrollIntent` (`editor-search-extensions.ts:29-35`) s'y accroche
— soit on émet le même `userEvent`, soit on appelle `scrollPosToSafeTop`
directement.

### Résultat — livrée après trois revues, une remédiation, et un correctif trouvé au runtime

**Décision produit prise en cours de slice** : le flash surligne les **plages
matchées**, pas la ligne entière, conformément à la spec (`:119`). Ça coûte un
champ Rust — le décalage de la fenêtre de snippet — et une modification du
contrat IPC, parce que `snippet_window` rebase les plages dans une fenêtre de
400 caractères dont le décalage n'était pas transmis. Sans lui, une plage sur une
ligne longue pointe au mauvais endroit.

Les trois revues ont bloqué, et chacune a trouvé une part que les deux autres
avaient manquée. Le point commun des trois : **l'observable des tests était l'état
privé du champ**, jamais ce qui est peint. Trois mutations d'une ligne
supprimaient tout l'effet visible en laissant 692 tests verts —
`provide: () => []`, le champ retiré de `createEditorExtensions`, et le sélecteur
CSS renommé. Un dispatch d'effet sur un état qui ne contient pas le champ est un
**no-op silencieux** de CodeMirror : aucune erreur, aucun log.

Ce qui a atterri :

- `content_search.rs` — `ContentMatch.line_content_offset`, le décalage en points
  de code de `line_content` dans sa ligne source ; `snippet_window` rend une
  struct nommée plutôt qu'un triplet dont le troisième membre serait ambigu.
- `shared/content-search-event.contract.json` — le champ, épinglé des deux côtés.
- `pending-target.ts` — la cible `line` porte ses plages, en points de code
  relatifs à la **ligne source** : le porteur ignore la notion de fenêtre.
  `heading` n'en porte pas, donc **pas de flash sur le chemin des ancres**, le
  comportement vérifié de la slice 4 reste intact.
- `match-flash.ts` — `setMatchFlash`, `matchFlashField`, minuterie par vue en
  `WeakMap`, vidage sur `tr.isUserEvent("writer")`.
- `link-navigation.ts` — `targetDocPos` devient `resolveTarget` et rend
  `{ pos, flash }` : `jumpToPos` reste le point d'application unique pour les
  deux chemins. Renommage forcé par le type de retour, pas opportuniste.

Défauts corrigés en remédiation :

- **Rien ne vérifiait que le champ peint.** Fermé par un test qui construit
  l'état à partir de la **vraie** liste `createEditorExtensions` et lit la
  facette `EditorView.decorations`, pas le champ. Fichier séparé : le test du
  champ mocke `viewport-parse`, et mocker un module de la liste de production
  dans le test qui certifie cette liste aurait vidé la garantie.
- **Durée et nom de classe en double source de vérité.** Mesuré : à 2000 la
  marque reste 800 ms totalement transparente, à 600 elle disparaît au milieu du
  fondu — le saut visuel que le commentaire CSS dit vouloir éviter. Fermé par
  liaison, pas par test de cohérence : la durée part du TS vers la feuille en
  custom property, et plus aucun littéral ne subsiste côté CSS. Un test de
  cohérence constate la dérive, la liaison la rend impossible.
- **Le tri de `wanted` n'était épinglé par rien** — il porte pourtant l'invariant
  du curseur monotone, seule raison pour laquelle la conversion est en un
  passage.
- **Un saut sans rien à flasher laissait allumé le flash précédent** : la garde
  d'optimisation était aussi le seul chemin d'extinction. Chaque saut est
  désormais autoritaire sur le champ.
- Divers : sortie anticipée de `lineFlashRanges` (16,4 ms mesurés sur une ligne
  ASCII de 2 Mio avec 50 plages, en synchrone dans le rAF du saut) ; fake de
  scroller réaligné sur le navigateur — **le défaut que la slice 5 avait déjà
  fermé une fois** ; `expiries.delete` inerte supprimé ; deux affirmations
  fausses corrigées à leur source, dont une dans le CHANGELOG qui promettait
  qu'une plage débordante est abandonnée alors qu'elle est clampée et peinte.

**Défaut trouvé au runtime, invisible à la lecture et à la suite unitaire.**
Un saut vers un match **déjà en train de flasher** arrivait sur un surlignage
quasi invisible : alpha mesuré 0,09–0,12 au lieu de 0,45, et extinction complète
530 ms après le saut alors que le span restait 1 200 ms dans le DOM. Cause
racine : le renderer inline de CodeMirror réutilise le **même élément DOM** pour
une marque qui compare égale (`this.cache.find(MarkTile, m => m.mark.eq(mark))`).
Une animation CSS appartient à l'élément, pas à la décoration : elle ne
redémarrait jamais et portait le temps écoulé du flash précédent, pendant qu'une
minuterie neuve de 1 200 ms était armée. Le commentaire du fichier affirmait
exactement l'inverse — c'est pourquoi rien ne paraissait anormal à la lecture.
Corrigé par un numéro de série par flash porté en attribut, qui fait manquer le
cache. Après correctif : `currentTime` à 0 à l'arrivée, alpha exactement 0,45.
Atteignable à la main, pas hypothétique : le scénario e2e l'a déclenché en étant
simplement placé après un test qui fait le même saut.

**Risques résiduels assumés :**

- **`prefers-reduced-motion` n'est pas prouvé de bout en bout.** La règle existe
  et la couleur de repos est mesurée à pleine intensité, mais faire matcher la
  media query depuis le harnais s'est avéré impossible : `com.apple.universalaccess`
  refuse l'écriture, et `com.apple.Accessibility` seul ne bouge pas `matchMedia`.
- **Trois choses que le flash ne peint pas, toutes acceptées**, documentées dans
  `docs/editor.md` : une plage qui chevauche le bord de la fenêtre de snippet est
  rognée côté Rust, donc un mot peut s'afficher à moitié surligné (« on flashe ce
  qu'on t'a montré ») ; une plage sous une `Decoration.replace` — image repliée,
  mermaid, math, bloc de code — ne peint rien ; les plages tombent sur des
  frontières de points de code, pas de graphèmes, donc un flash peut couper une
  séquence ZWJ (même limite que `splitHighlightRanges`, assumée en slice 3).
- La sortie anticipée de `lineFlashRanges` est équivalente sur la sortie : sa
  suppression est un pic de latence, pas un échec, et aucun test ne l'attrape.
- La minuterie dispatche encore son extinction après un swap qui a déjà vidé le
  champ. Inoffensif ; relier le chemin de transaction au chemin de minuterie pour
  économiser une transaction sans effet coûterait plus que ça ne rapporte.

**Vérification** (depuis `apps/desktop/`, `apps/desktop/src-tauri/`) :

```
../../node_modules/.bin/vp check   → exit 0 — 0 errors, 1 warning (e2e/wdio.conf.js, préexistant)
../../node_modules/.bin/vp test    → exit 0 — 56 fichiers, 697 tests passés (692 avant remédiation, 675 avant la slice)
cargo test                         → exit 0 — 207 passés (205 avant la slice)
cargo clippy                       → exit 0 — 11 warnings préexistants, aucun dans content_search.rs
cargo fmt --check                  → exit 0
```

**Vérification runtime — faite.** `content-search.spec.js` passe de 12 à
**13 scénarios**, onze exécutions consécutives toutes vertes, suite rejouable.
Rouge/vert mesuré sur le scénario durci :

| Mutation                                         | Résultat |
| ------------------------------------------------ | -------- |
| `.cm-match-flash` renommé dans la CSS            | attrapée |
| `matchFlashField` retiré du registre             | attrapée |
| durée littérale `20000ms` au lieu de la variable | attrapée |
| correctif du numéro de série annulé              | attrapée |

Le scénario tel qu'écrit avant la passe runtime laissait **survivre** la
troisième : son garde comparait la couleur à la chaîne `rgba(0, 0, 0, 0)`, que
WebKit ne produit jamais pour un fond animé — il rapporte `oklab(…)`. Le garde ne
pouvait donc attraper aucun fondu. Durci en lisant l'alpha.

À l'œil, sur capture : un surlignage à la manière d'un marqueur, tenu à plat
600 ms puis fondu sur 600 ms, sur les tokens seuls et sans décalage de métriques.

**Suite e2e complète — un échec préexistant, hors périmètre.** Le correctif
touche une extension CodeMirror partagée par tous les panneaux, donc la suite
entière a été lancée, pas seulement `content-search.spec.js`.
`latex-math.spec.js` échoue sur ses 4 scénarios, le premier étant « opens the
seeded document from the sidebar » — le document ne s'ouvre jamais et les trois
autres en cascadent. **Vérifié préexistant** : l'échec est identique sur `HEAD`
sans la slice 6 (travail remisé, bundle reconstruit, même sortie), donc ni
l'ajout de `matchFlashField` à la liste d'extensions ni le reste de la slice n'en
sont la cause. À traiter séparément ; noté dans `TODOS.md`.

Piège d'outillage à connaître avant de relancer : le bundle e2e **ne se
construit pas** avec un `cargo tauri build` nu. Il faut le script de
`e2e/package.json` — `--features e2e --bundles app`, plus le `--config` qui
change l'identifiant et coupe les artefacts d'updater. Sans la feature, le plugin
WebDriver est absent, l'app se lance sans écouter, et wdio meurt en timeout de
création de session — un symptôme qui ne nomme pas sa cause. Un build nu
**écrase** en prime le bundle valide.

## Intendance

- Branche dédiée ; un commit par slice. Le bump `ignore` en commit de tête,
  révocable seul.
- `TODOS.md:74` (sortir du backlog), `CHANGELOG.md`, `docs/keyboard-shortcuts.md`.
- **Amender la spec** dans le même mouvement : elle propose `rayon` (inutile, le
  scan part de l'index en mémoire) et le crate `grep` ombrelle (voir [D-1]), et
  il faut y acter le contrat de fraîcheur disque, le sort de l'icône de sidebar,
  et la règle de snippet retenue.

## Ce que ce plan ne fait pas

Déclaré, pas oublié : pas de regex, pas de search-and-replace, pas de fichiers
non-markdown, pas d'index inversé (la spec dit explicitement de ne pas concevoir
la v1 autour), pas de recherche dans les buffers modifiés non sauvegardés, pas
de toggle de casse dans l'UI.
