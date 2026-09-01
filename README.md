# Générateur de questionnaire LimeSurvey

Outil web (statique, sans backend) pour importer une banque de questions, en
sélectionner une partie, ajouter des champs personnalisés (nom, prénom...),
et générer un fichier `.lss` prêt à importer dans LimeSurvey.

**V1 : questionnaire à plat**, sans niveaux ni paliers de déblocage — voir
`/Users/bertrand.formet/.claude/plans/peaceful-knitting-swan.md` pour le plan
complet et les décisions d'architecture.

## Utilisation locale

Un serveur statique suffit (les modules ES ont besoin de http(s), pas de
`file://`) :

```bash
python3 -m http.server 8743
```

Puis ouvrir `http://localhost:8743/`.

## Structure

- `js/lss/` — le cœur du générateur, indépendant de l'UI. `builders.js` +
  `validate.js` encodent les 11 règles de la checklist « Générer un LSS
  valide ». `quiz-flat.js` assemble une séquence ordonnée (questions +
  champs) en document LSS. C'est la partie à réutiliser pour une V2 avec
  niveaux.
- `js/sequence.js` — construit l'ordre unique champs+questions (positions
  "au début" / "après telle question" / "à la fin"), utilisé à la fois par
  l'aperçu et par le générateur réel, pour qu'ils ne divergent jamais.
- `js/import/parse-tabular.js` + `normalize.js` — CSV/TSV (délimiteur
  auto-détecté) vers la forme canonique des questions.
- `js/import/converters/` — vendorisé depuis
  [mdfusion](https://github.com/bertrandformet/mdfusion) (même auteur, même
  archi 100% statique) : convertit PDF/DOCX/XLSX/HTML/... en Markdown,
  entièrement côté client (pdf.js, mammoth+turndown, SheetJS... chargés en
  lazy-load depuis esm.sh).
- `js/import/parse-markdown-quiz.js` — reconnaît, dans le Markdown obtenu (ou
  un `.md` déposé tel quel), les motifs question/corrigé déjà rencontrés
  (`## Question N — Titre` + options `- [ ] **A.** ...`, et un corrigé
  séparé `### Question N — Réponses X et Y`) ; fait le lien automatiquement
  entre un quiz et son corrigé importés comme deux fichiers distincts.
- `js/state.js`, `js/main.js` — état et câblage de l'interface (import
  multi-fichiers/multi-formats, sélection + édition, positionnement des
  champs, aperçu, génération).
- `tests/test.html` — fixture de test du cœur du générateur.
- `tests/fixtures/` — exemples réels (PDF, DOCX) utilisés pour vérifier la
  conversion.

## Import : ce qui est automatique, ce qui ne l'est pas

**Automatique** : CSV/TSV au gabarit ci-dessous, et tout document Markdown
(ou converti en Markdown depuis PDF/DOCX/...) qui suit la structure
`## Question N — Titre` + `**Question ?**` + `- [ ] **A.** ...` — avec,
éventuellement, un corrigé séparé au format `### Question N — Réponses X et
Y` qui vient compléter automatiquement les bonnes réponses par
correspondance de numéro (et de niveau, si un titre `# Niveau ...` précède
les questions dans les deux documents).

**Pas automatique** : un PDF ou DOCX n'ayant pas cette structure (le cas le
plus courant — pdf.js n'extrait que du texte brut positionné, sans gras ni
titres, donc un PDF « normal » ne se structurera jamais tout seul). Le texte
est quand même extrait et affiché dans un panneau « non reconnu » pour
relecture/adaptation manuelle plutôt que d'échouer silencieusement.
Structurer un document à la mise en page vraiment libre nécessiterait un
LLM — piste examinée (Albert) mais **l'appel direct depuis le navigateur est
confirmé bloqué par CORS** (`No 'Access-Control-Allow-Origin' header`,
vérifié en conditions réelles) : il faudrait un petit relais serveur, ce qui
sort du périmètre « site statique, aucun backend » retenu jusqu'ici.

Gabarit CSV/TSV (en-tête requis) :

```
code;type;texte;option_a;option_b;option_c;option_d;correct
Q1;L;Quelle est la capitale de la France ?;Lyon;Paris;Marseille;;B
Q2;M;Cochez les nombres pairs;2;3;4;5;"A,C"
```

- `type` : `L` (choix unique) ou `M` (cases à cocher, plusieurs bonnes
  réponses possibles)
- `correct` : un code pour `L` ; plusieurs codes séparés par une virgule (ou
  point-virgule/espace) pour `M`
- jusqu'à 6 options (`option_a`..`option_f`)

## État des lieux / limites connues (V1)

- **Type de question S (texte court, champs personnalisés) confirmé** en
  conditions réelles (`question_theme_name = "shortfreetext"`) — importé et
  testé avec succès sur une vraie instance LimeSurvey.
- **XLSX/XLS** convertis en tableau Markdown par les convertisseurs
  vendorisés, mais le tableau résultant n'est pas (encore) relu comme un
  gabarit de questions par `parse-markdown-quiz.js` — pour l'instant,
  utiliser directement le CSV/TSV au gabarit pour les tableurs.
- **Notation** : tout-ou-rien fait main (formules EM) pour L et M, pas
  d'utilisation de la notation native `assessment_value` de LimeSurvey — un
  agent de planification avait suggéré cette simplification pour L, mais
  elle a été écartée pour rester sur un mécanisme entièrement vérifié plutôt
  que d'introduire une nouvelle hypothèse non testée (accès à un total
  d'évaluation courant depuis une formule EM).
- **Pas de dépôt GitHub créé** — le code est prêt localement
  (`/Users/bertrand.formet/code/generateur-quiz-limesurvey`) mais la
  création du dépôt distant et le push demandent une confirmation explicite
  (action visible/partagée), pas encore donnée.

## Prochaine étape

Tests réels sur une instance LimeSurvey déjà menés avec succès (multi-fichiers,
positionnement de champs, édition, type S) — voir le plan pour le protocole
complet. Reste à décider : gabarit XLSX pour `parse-markdown-quiz.js`, et
si/quand pousser le dépôt sur GitHub Pages.
