# HASPAD.com

HASPAD est une plateforme SaaS de création, correction et déploiement de sites avec orchestration IA.

## Production

- Site public: https://haspad.com
- API publique: https://api.haspad.com
- Netlify: hébergement/déploiement.
- Supabase: PostgreSQL, RLS et temps réel; l'identité applicative visible est gérée par Netlify Identity.

## Authentification

- Email / mot de passe via Netlify Identity.
- Google, GitHub, GitLab et Bitbucket via les fournisseurs externes Netlify Identity.
- Une table de liaison serveur associe chaque identité Netlify aux données historiques Supabase sans exposer Supabase Auth au navigateur.
- Les callbacks de production doivent utiliser `https://haspad.com`.
- Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` ou les secrets OAuth au navigateur.

## Crédits

- 500 crédits offerts à l'inscription.
- Déploiement initial: 390 crédits.
- Redéploiement: 150 crédits.
- Pro: 6 800 crédits.
- Business: 19 089 crédits.

Le débit des crédits est atomique dans PostgreSQL. Une erreur de compilation après débit déclenche un remboursement serveur.

## Paiements

PayDunya est le prestataire de paiement activé côté serveur. Les montants XOF et les crédits sont déterminés côté serveur; les crédits ne sont attribués qu'après confirmation PayDunya vérifiée.

## Base de données

Appliquer `supabase/credits.sql` dans le SQL Editor Supabase avant d'activer la facturation.

Les tables de crédits et de paiement ont RLS. Les fonctions privilégiées sont réservées à `service_role`.

## Domaine

Le dépôt gère la vérification RDAP et l'enregistrement de la configuration du domaine. L'achat/enregistrement auprès d'un registrar n'est pas activé tant qu'un prestataire de paiement et un adaptateur registrar n'ont pas été configurés.

Dans Netlify, le domaine personnalisé doit être rattaché au site `haspad-ai`, puis le DNS doit pointer vers Netlify. Le sous-domaine `api.haspad.com` doit également être configuré vers l'infrastructure qui exécute les fonctions API.

## Offre Startup

- 4 000 crédits.
- Centre de contrôle logique isolé par projet.
- Métriques serveur, erreurs, pages, composants, recommandations et journal des agents.
- Agent Gemini 3.8 Flash configurable par `GEMINI_MODEL`.
- L'agent reçoit une demande et retourne un **blueprint JSON validé**, jamais du SQL arbitraire exécutable.
- GitHub, GitLab et Bitbucket restent des intégrations distinctes; leurs secrets ne sont jamais exposés au navigateur.

### Sécurité des crédits

Le débit utilise un verrou PostgreSQL `FOR UPDATE` dans une fonction `SECURITY DEFINER` avec `search_path = ''`. Les remboursements sont idempotents grâce à la référence unique de transaction. Le navigateur ne fournit jamais le `user_id` de facturation: le serveur vérifie le cookie JWT Netlify Identity puis résout l'identité vers l'utilisateur Supabase interne.

### Centre de contrôle

Appliquer `supabase/control_center.sql` après le schéma principal. RLS est activé sur les tables exposées et l'accès est limité aux membres du projet.
