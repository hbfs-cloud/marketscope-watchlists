# MarketScope

Cockpit statique et responsive pour consolider 25 listes Trading 212 (287 instruments) sur une seule page.

## Fonctions

- Recherche, filtrage par liste/marché/tag/setup et tris quantitatifs.
- Setups détectés sur données réelles : momentum, breakout, pullback, au-dessus de MA200, volume relatif élevé et RSI survendu.
- Vue détail avec MA20/50/100/200, RSI 14, MACD/signal, volume relatif, VWAP, ATR, performance semaine et contribution OBV journalière.
- Logos instrument et graphique technique Finviz directement visible pour les titres US ; historique Yahoo pour les autres marchés lorsque disponible.
- Tags personnels et alertes de prix avec TTL, stockés localement.
- Flux WebSocket Yahoo expérimental pendant que l'onglet est ouvert.
- Synchronisation Google optionnelle via Firebase Auth + Firestore.
- PWA installable et cache hors-ligne.
- Partage natif ou copie de lien, adapté à Telegram.

## Publication GitHub Pages

Le site n'a ni build ni dépendance. Publier directement la racine de ce dossier sur la branche `main`, puis choisir **Settings → Pages → Deploy from a branch → main / root**.

## Synchronisation Google

1. Créer un projet Firebase.
2. Activer **Authentication → Google**.
3. Créer une base Firestore.
4. Ajouter le domaine GitHub Pages dans **Authentication → Authorized domains**.
5. Coller la configuration publique de l'application Web Firebase dans le dialogue **Synchro Google**.

Règles Firestore minimales :

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

La configuration Firebase Web est publique par nature, mais les règles ci-dessus sont obligatoires. Ne jamais ajouter une clé de compte de service au dépôt.

## Limites explicites

- Les cours importés de Trading 212 sont un instantané.
- Le WebSocket et l'endpoint graphique Yahoo sont non officiels, sans SLA ni garantie de redistribution.
- Les alertes de cette version statique fonctionnent uniquement tant que la page reste ouverte. Des alertes fiables onglet fermé nécessitent un backend et Web Push.
- Les métriques quotidiennes et setups dépendent de la disponibilité du scanner TradingView côté navigateur.
- « OBV Δ jour » est la contribution signée du volume de la séance, pas l'OBV cumulatif historique.
- Les graphiques non-US affichent un aperçu local si l'historique Yahoo est indisponible ; Finviz est affiché directement pour les titres US avec repli local en cas d'échec.
