# HASPAD

Plateforme SaaS AI de création et déploiement de sites web.

## Fondation intégrée

- Architecture multi-tenant: sites, pages, assets, configurations privées et déploiements.
- AST whitelisté et validation Zod.
- Compilation HTML/CSS avec échappement et assainissement CSS.
- Hash SHA-256 déterministe: aucun timestamp dans l’entrée du hash.
- Contrôle d’accès par propriétaire et RLS Supabase.
- Snapshots de déploiement immuables et résolution par hostname.
- Secrets serveur uniquement; aucune clé privée dans le frontend ou l’AST.
- Google Pay prévu côté serveur avec un processeur compatible; aucun règlement réel n’est simulé.

## Développement

`npm install`
`npm run check`
`npm run dev`
