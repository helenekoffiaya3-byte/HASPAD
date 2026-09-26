# HASPAD.com

HASPAD est une plateforme SaaS de création, correction et déploiement de sites avec orchestration IA.

## Production

- Site public: https://haspad.com
- API publique: https://api.haspad.com
- Netlify: hébergement/déploiement, sans être l'identité publique du produit.
- Supabase: Auth, PostgreSQL, RLS et temps réel.

## Authentification

- Email / mot de passe via Supabase Auth.
- Google, GitHub, GitLab et Bitbucket via OAuth.
- Les callbacks de production doivent utiliser `https://haspad.com`.
- Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` ou les secrets OAuth au navigateur.

## Crédits

- 500 crédits offerts à l'inscription.
- Déploiement initial: 390 crédits.
- Redéploiement: 150 crédits.
- Pro: 6 800 crédits.
- Business: 19 089 crédits.

Le débit des crédits est atomique dans PostgreSQL. Une erreur de compilation après débit déclenche un remboursement serveur.

## CinetPay

Le paiement utilise l'API Checkout CinetPay. Le serveur crée d'abord la transaction, puis redirige vers le guichet. Le webhook vérifie toujours le statut réel auprès de CinetPay avant d'accorder les crédits et protège le traitement contre les doublons.

Variables obligatoires en production:

- `CINETPAY_API_KEY`
- `CINETPAY_SITE_ID`
- `CINETPAY_SECRET_KEY`
- `CINETPAY_PRO_AMOUNT_XOF`
- `CINETPAY_BUSINESS_AMOUNT_XOF`

Le montant et les crédits sont déterminés côté serveur; le navigateur ne peut pas les modifier.

## Base de données

Appliquer `supabase/credits.sql` dans le SQL Editor Supabase avant d'activer la facturation.

Les tables de crédits et de paiement ont RLS. Les fonctions privilégiées sont réservées à `service_role`.

## Domaine

Le dépôt ne peut pas, à lui seul, créer le certificat DNS de `haspad.com`. Dans Netlify, le domaine personnalisé doit être rattaché au site `haspad-ai`, puis le DNS doit pointer vers Netlify. Le sous-domaine `api.haspad.com` doit également être configuré vers l'infrastructure qui exécute les fonctions API.

Une fois le DNS actif, aucune URL `netlify.app` ne doit être utilisée comme URL publique par l'application.
