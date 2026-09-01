# Générateur de questionnaire LimeSurvey

Un outil web pour créer un questionnaire LimeSurvey à partir d'une
banque de questions, sans avoir à connaître le format technique attendu par
LimeSurvey. Tout se passe dans le navigateur, aucune donnée n'est
envoyée à un serveur.

**👉 Utiliser l'outil en ligne : https://bertrandformet.github.io/generateur-limesurvey/**

## Comment ça marche

1. **Importer** : déposez un ou plusieurs fichiers (CSV, Word, PDF,
   Markdown...) ou du texte contenant vos questions. Un corrigé séparé peut compléter
   automatiquement les bonnes réponses.
2. **Sélectionner et modifier** : cochez les questions à garder ; le texte
   des questions et des réponses, ainsi que le nombre de points attribués à
   chacune, sont modifiables directement.
3. **Ajouter des champs** : nom, prénom, établissement, une consigne... à
   placer où vous voulez dans le questionnaire.
4. **Aperçu** : vérifiez l'ordre exact avant de générer.
5. **Générer** : téléchargez le fichier `.lss` prêt à importer.

## Importer le fichier dans LimeSurvey

1. Dans LimeSurvey, allez dans **Enquêtes → Créer une enquête**, puis
   choisissez **Importer une enquête** (ou l'icône d'import en haut de la
   liste des enquêtes).
2. Sélectionnez le fichier `.lss` téléchargé et validez l'import.
3. L'enquête est créée à l'état inactif : relisez-la, puis activez-la
   quand vous êtes prêt.

## Format d'import (CSV/TSV)

Pour un import garanti sans ajustement, utilisez ce gabarit (téléchargeable
directement depuis l'outil) :

```
code;type;texte;option_a;option_b;option_c;option_d;correct;coefficient
Q1;L;Quelle est la capitale de la France ?;Lyon;Paris;Marseille;;B;1
Q2;M;Cochez les nombres pairs;2;3;4;5;"A,C";2
Q3;T;Autres remarques (réponse libre, non notée);;;;;;
```

- `type` : `L` (choix unique), `M` (cases à cocher, plusieurs bonnes
  réponses possibles) ou `T` (réponse libre, non notée — les colonnes
  d'options et `correct` sont alors ignorées)
- `correct` : un code pour `L` ; plusieurs codes séparés par une virgule
  pour `M`
- `coefficient` : nombre de points pour cette question (optionnel, 1 par
  défaut ; sans effet pour `T`)
- jusqu'à 6 options (`option_a`..`option_f`)

Un fichier Word, PDF ou Markdown peut aussi être importé directement : s'il
suit une mise en page reconnaissable (titres de question, cases à cocher),
les questions sont détectées automatiquement ; sinon, le texte est extrait
et affiché pour un ajustement manuel avant réimport.

## Confidentialité

Tout se passe dans le navigateur, rien n'est envoyé à un serveur. Les
fichiers, les questions, les modifications ne sont jamais transmis nulle
part : l'outil ne dispose d'ailleurs d'aucun serveur à qui les envoyer.
Rien n'est conservé non plus d'une visite à l'autre : fermer ou recharger
la page efface tout ce qui a été importé ou saisi.

Seule exception : au premier import d'un PDF, DOCX ou XLSX, le navigateur
télécharge la bibliothèque nécessaire à sa lecture (ex. pdf.js) depuis un
service de distribution de code public (esm.sh). Ce téléchargement ne
contient que du code, jamais vos données.

## Licence

[CC BY 4.0](LICENSE) — Bertrand Formet. Réutilisation et modification
libres, y compris à des fins commerciales, à condition de créditer l'auteur
original.
