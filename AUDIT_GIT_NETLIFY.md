# HASPAD — Audit Git → HASPAD → Netlify

Date: 2026-09-27

## Corrigé

- Architecture cible conservée sur Netlify Functions + Supabase.
- GitHub OAuth ajouté avec validation d'état liée à l'utilisateur HASPAD.
- Tokens GitHub chiffrés AES-256-GCM avant stockage.
- Support des refresh tokens GitHub lorsque les tokens expirants sont activés.
- Liste des dépôts, création de dépôt et liste des branches ajoutées.
- Le navigateur ne fournit plus les fichiers à publier : HASPAD compile les pages stockées côté serveur.
- Push GitHub effectué avec blobs → tree → commit → ref, sans force-push.
- Déploiement Netlify effectué par API à partir du build HASPAD après le commit Git.
- Statut de déploiement et URL Netlify suivis côté serveur.
- Débit de crédits atomique et idempotent ajouté pour les déploiements Git.
- Remboursement automatique uniquement lorsqu'aucun déploiement Netlify n'a été déclenché.
- Migration Supabase appliquée et versionnée dans supabase/migrations/20260927140712_git_github_integration.sql.
- Les advisory de sécurité Supabase sont sans alerte après la migration.
- package.json réaligné avec l'architecture Netlify ; l'ancien server.js référencé n'existe pas et n'est plus utilisé.

## Variables requises

Secrets à fournir par le propriétaire du projet :

- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET

Variables prévues par le code :

- GITHUB_OAUTH_REDIRECT_URI=https://haspad.com/.netlify/functions/github-callback
- GITHUB_OAUTH_STATE_SECRET
- GITHUB_TOKEN_ENCRYPTION_KEY
- GITHUB_API_VERSION=2022-11-28
- GIT_DEPLOY_CREDIT_COST=1

## Non terminé

- GitLab repository OAuth/API n'est pas encore implémenté.
- Bitbucket repository OAuth/API n'est pas encore implémenté.
- Les boutons GitLab/Bitbucket de Netlify Identity sont distincts de l'accès API aux dépôts Git.
- La création de l'application GitHub et la saisie du Client ID/Client Secret restent des opérations de configuration externe.

## Sécurité

Les secrets ne sont pas commités dans Git. Les tokens utilisateur GitHub sont chiffrés en base. Les endpoints Git exigent une session Netlify Identity. Les fichiers déployés sont compilés depuis les données HASPAD côté serveur.
