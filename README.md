# HASPAD.com

HASPAD est une plateforme SaaS de création, correction et déploiement de sites avec orchestration IA.

## Production

- Site public: https://haspad.com
- API publique: https://haspad.com/api
- Hébergement et déploiement Netlify pour les projets compatibles Netlify.
- Netlify Identity est le système d'authentification applicative.
- La base applicative utilise l'infrastructure Netlify Database; aucune dépendance Supabase n'est requise.

## Sécurité de déploiement

Le flux GitHub est strictement séparé en deux phases:

1. **Analyse / preflight**: lecture du dépôt, détection du framework, runtime, commande, répertoire de publication, port et variables requises. Cette phase ne débite aucun crédit et ne lance aucun build Netlify.
2. **Deploy explicite**: le déploiement n'est lancé qu'après validation du preflight et clic explicite sur Deploy.

La commande de build est détectée côté serveur à partir du dépôt; elle n'est pas saisie manuellement par l'utilisateur.

Les secrets OAuth, API et runtime restent côté serveur. Ne jamais les exposer au navigateur, les committer dans Git ou les inclure dans les fichiers générés.

## Variables critiques

Les variables de production doivent être configurées dans **Netlify → Site configuration → Environment variables**.

Variables GitHub OAuth:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI=https://haspad.com/.netlify/functions/github-callback`
- `GITHUB_OAUTH_STATE_SECRET`
- `GITHUB_TOKEN_ENCRYPTION_KEY`
- `GITHUB_API_VERSION=2022-11-28`

IA:

- `OPENAI_API_KEY` — serveur uniquement.
- `CHATGPT_MODEL` — modèle utilisé par l'analyseur, si défini.

Déploiement:

- `NETLIFY_AUTH_TOKEN` — serveur uniquement.
- `GIT_DEPLOY_CREDIT_COST=300`.

Paiement:

- PayDunya est le prestataire activé côté serveur.
- Les secrets PayDunya sont serveur uniquement.
- Les crédits ne sont attribués qu'après confirmation serveur vérifiée.

## Crédits

Le coût du déploiement Git est **300 crédits**.

Le débit doit être atomique et idempotent. Aucun débit ne doit avoir lieu pendant l'analyse ou lorsque le preflight échoue. Un même déploiement ne doit jamais être débité deux fois. Lorsqu'un déploiement échoue avant son acceptation par la cible, le mécanisme serveur prévu doit pouvoir effectuer un remboursement idempotent.

## Authentification

- Email / mot de passe via Netlify Identity.
- La session utilisateur est vérifiée côté serveur.
- L'identité Netlify détermine l'utilisateur autorisé à accéder à ses projets.
- Les tokens GitHub sont chiffrés côté serveur.
- GitLab et Bitbucket restent en pause et ne doivent pas être réactivés sans décision explicite.

## Base Studio

Base Studio est une couche fonctionnelle distincte d'une base de données classique. Son interface et ses opérations doivent rester séparées du stockage applicatif.

## Domaine

Le dépôt gère la vérification RDAP et la configuration du domaine. L'achat/enregistrement auprès d'un registrar n'est pas considéré comme opérationnel tant que l'adaptateur registrar et son paiement serveur ne sont pas validés.

## Développement local

Copier `.env.example` vers `.env` uniquement pour le développement local et renseigner les secrets hors Git.

**Ne jamais committer `.env`, les clés privées, les tokens OAuth ou les certificats.**
