# Plan d'exécution — Recherche de contenu (fuzzy + grep)

Spec : [`fuzzy-search-grep-spec.md`](./fuzzy-search-grep-spec.md)
Branche : `feat/content-search`

Document vivant. Chaque slice est mise à jour ici au fur et à mesure :
statut, décisions prises, écarts au plan initial, preuve de vérification.

## Statut

| Slice | Sujet | Statut |
|---|---|---|
| 0 | Dépendances | ✅ fait |
| 1 | Cœur de scan et ranking (Rust) | ⬜ à faire |
| 2 | Commande streamée, annulation, transport | ⬜ à faire |
| 3 | Palette | ⬜ à faire |
| 4 | Porteur de cible + correctifs navigation | ⬜ à faire |
| 5 | Saut à la ligne | ⬜ à faire |
| 6 | Flash bref | ⬜ à faire |

## Conventions de travail

- Une slice = un commit. Un sous-agent par slice.
- **Commentaires minimes.** Un commentaire explique un *pourquoi* non évident
  (invariant, piège, contrainte externe). Jamais de narration du diff, jamais de
  redite de la signature. Le code existant est plus bavard que cette règle —
  ne pas s'en inspirer.
- Pas de refactor opportuniste, pas d'abstraction spéculative.
- Vérification obligatoire avant de clore une slice (commandes + sortie collées).

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

| Point | Choix | Pourquoi |
|---|---|---|
| Sémantique fuzzy | **Niveau fichier** : tous les tokens présents quelque part dans le fichier | Conforme à la spec (`:46`, « rank **files** whose content contains the tokens »). La variante par ligne renvoyait zéro sur `channels throughput` quand le premier token est un heading et le second le paragraphe en dessous — et sur toute prose wrappée à 80 colonnes. **[RT-3]** |
| Snippet | La ligne du fichier contenant le plus de tokens ; départage par la première | Règle unique et explicable, lève l'ambiguïté du snippet en mode fichier. |
| Proximité | Scorée sur une fenêtre de lignes, pas sur le fichier entier | Deux tokens à 3 lignes d'écart valent mieux qu'à 300. |
| Mode grep | Préfixe `/` → littéral, pas de ranking | Conforme à la spec. |
| Casse | **Smart case** dans les deux modes | Exigé par la spec (`:20`) : seul le *toggle UI* est hors scope, pas le comportement. |
| Espace de lignes | Le Rust émet des numéros **relatifs au corps**, frontmatter exclu | L'éditeur ne contient jamais le frontmatter. Voir [RT-1]. |
| Unité des offsets | **Points de code**, jamais des octets | Voir [RT-2]. |
| Transport | `tauri::ipc::Channel` (lots) | Les docs Tauri v2 disent que le système d'events n'est pas fait pour le haut débit. |
| Annulation | Génération coopérative + un seul scan en vol par fenêtre | Tauri n'a pas d'annulation first-class ([#8351](https://github.com/tauri-apps/tauri/issues/8351) ouvert). |
| Matcher | `grep-regex` (un matcher **par token**), pas d'alternation | Voir [D-1]. |

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
  une seule ligne plus longue que la limite fait échouer la recherche sur *tout
  le fichier* (`BufferAllocation::Error`), donc une note contenant un bloc de
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

**Un seul scan en vol par fenêtre.** L'annulation est coopérative *entre*
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

## Slice 3 — La palette *(point de livraison naturel)*

À la fin de cette slice la feature est utile et complète : on cherche, on voit,
on ouvre. Le saut à la ligne vient après.

**Composant séparé** `src/components/content-search-palette.tsx`, pas une
troisième valeur de `commandPaletteIntent`. L'union (`ui-store.ts:3`) est
consommée par **7** conditionnels dans `command-palette/index.tsx`
(`:82,84,211,221,243,258,275`) et le layout diverge de toute façon (groupes par
fichier, extraits multi-lignes). `docs/consolidation.md:38` nomme explicitement
« multiple files containing the same set of if/switch cases » comme
l'anti-pattern à éviter.

**Propriétaire unique de l'état d'ouverture.** Deux booléens indépendants dans
`ui-store` recréeraient la dérive que `docs/consolidation.md` interdit. Un seul
discriminant de palette, avec exclusion mutuelle explicite quand `Cmd+Shift+F`
arrive alors que `Cmd+P` est déjà ouvert.

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
région cible *avant* de scroller, ou re-scroller après le commit de mesure.

**Vérification** : runtime obligatoire via le skill `verify`, sur un document de
plusieurs milliers de lignes contenant images et tables, plus un fichier avec
frontmatter, plus un résultat **dans le fichier déjà ouvert**. Confirmer aussi
que la position de scroll sauvegardée survit au saut.

## Slice 6 — Flash bref

Rien à réutiliser : `StateEffect` + `StateField` de `Decoration.mark` avec
nettoyage par `setTimeout`, plus une classe CSS. Noter qu'il n'existe **aucune**
règle CSS pour `.cm-searchMatch` dans le repo (le Cmd+F utilise le défaut
CodeMirror). Forme de dispatch à suivre : `jumpToMatch`
(`editor-search-store.ts:117-125`) ; son `userEvent: "select.search"` est
porteur, `searchScrollIntent` (`editor-search-extensions.ts:29-35`) s'y accroche
— soit on émet le même `userEvent`, soit on appelle `scrollPosToSafeTop`
directement.

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
