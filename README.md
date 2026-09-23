# HASPAD

Backend d’authentification et de gestion des sites HASPAD.

## Authentification
- Inscription email/mot de passe avec bcrypt
- Connexion email/mot de passe
- Access JWT 15 minutes
- Refresh JWT 7 jours dans cookie HttpOnly
- Préparation SSO Google, GitHub, GitLab et Bitbucket

## Configuration
Copier `.env.example` vers `.env` et renseigner les secrets uniquement localement.

Ne jamais committer `.env`, les mots de passe, les clés JWT ou les clés Supabase serveur.
