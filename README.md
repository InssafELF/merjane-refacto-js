### Consignes JS:

- Si probleme de version pnpm, utiliser `corepack enable pnpm` qui devrait automatiquement utiliser la bonne version
- Ne pas modifier les classes qui ont un commentaire: `// WARN: Should not be changed during the exercise
`
- Pour lancer les tests: `pnpm test`
  - integration only in watch mode `pnpm test:integration`
  - unit only in watch mode `pnpm test:unit`


## Notes de refactoring

Le démarche de refactoring adoptée vise à améliorer la séparation des responsabilités en déplaçant les règles métier liées aux produits hors du contrôleur vers un service dédié, tout en conservant le comportement existant.

Les tests unitaires et d'intégration ont été ajoutés afin de garantir l'absence de régression fonctionnelle sur les cas métier.

Les tests s'appuient sur des bases SQLite temporaires, les connexions sont explicitement fermées lors du teardown afin d'assurer la stabilité de l'exécution sur les différents systèmes d'exploitation (notamment Windows).
