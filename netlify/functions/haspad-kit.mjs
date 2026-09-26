export const HASPAD_KIT_VERSION = "1.0.0";

export function buildHaspadKit(projectName = "[Nom du Projet]") {
  const name = String(projectName).trim() || "[Nom du Projet]";
  return {
    "HASPAD.md": `# Configuration HASPAD - ${name}

## Objectif du projet
[Décrire ici le but principal du site/application en 2-3 phrases.]

## Rôle de HASPAD
Le dépôt est autoporteur : les agents doivent lire HASPAD.md et .haspad/* avant toute modification.

## Stack obligatoire
- Frontend : [À définir]
- Backend : [À définir]
- Base de données : [À définir ou aucune]
- Hébergement : Netlify via HASPAD

## Règles générales
1. Préserver le fonctionnement existant.
2. Aucun secret ou clé API côté client.
3. Respecter strictement .haspad/agents.md.
4. Modifier uniquement les fichiers nécessaires.
5. Mobile-first, responsive et accessible.
6. Ne pas modifier .github/workflows/ sans autorisation explicite.

## Critères de validation
- Fonctionnalités obligatoires opérationnelles.
- Pas d'erreur JavaScript critique.
- API/routes principales fonctionnelles.
- Build conforme à .haspad/deployment.md.
- Aucun secret dans les fichiers générés.

## Contrat de sortie IA
JSON uniquement : {"files":[{"path":"...","action":"create|update|delete","content":"..."}],"summary":"..."}.`,
    ".haspad/agents.md": `# Instructions pour le Pipeline IA

## Ordre
1. Lire HASPAD.md et .haspad/*.
2. Inspecter le dépôt.
3. Gemini : interface/UX.
4. Claude : logique/API/backend.
5. ChatGPT : audit global.
6. Maximum 3 cycles de correction.
7. Pousser uniquement après validation finale.

## Gemini — Frontend & UI
Lire : HASPAD.md, design.md, requirements.md.
Ne pas modifier secrets, workflows ou backend sans nécessité.
Fichiers visuels et client uniquement.

## Claude — Backend & Logique
Lire : HASPAD.md, architecture.md, requirements.md, deployment.md.
Gérer API, serveur, données et intégrations.
Ne pas réécrire l'interface sans nécessité.

## ChatGPT — Audit & Qualité
Lire tout le kit.
Vérifier sécurité, fonctionnalités, régressions et build.
Séparer frontend_errors et backend_errors.
Retourner un JSON strict.

## Sécurité
Interdit : .env, clés privées, tokens, .git, node_modules et workflows CI/CD non demandés.`,
    ".haspad/architecture.md": `# Architecture Technique

## Frontend
- Entrée : [À définir]
- Composants : [À définir]
- Routage : [À définir]
- État : [À définir]

## Backend / API
- Runtime : [À définir]
- Routes principales :
  - [METHOD] /api/[route] : [Description]

## Données
- Base : [À définir]
- Tables/collections : [À définir]

## Intégrations
- Auth : [À définir]
- Paiement : [À définir ou aucune]
- APIs externes : [À définir]

## Contraintes
- Secrets uniquement via variables d'environnement.
- Timeouts et erreurs gérés pour les appels externes.
- Préserver la structure existante.`,
    ".haspad/design.md": `# Identité Visuelle et UI

## Direction artistique
[Décrire l'identité visuelle.]

## Couleurs
- Primaire : [À définir]
- Secondaire : [À définir]
- Accent : [À définir]
- États : [À définir]

## Typographie
- Titres : [À définir]
- Corps : [À définir]

## Responsive
- Mobile : priorité
- Tablette : [À définir]
- Desktop : [À définir]

## Composants
- Boutons : [À définir]
- Cartes : [À définir]
- Navigation : [À définir]
- Formulaires : [À définir]

## UX
États chargement/succès/erreur visibles. Contraste, clavier et animations légères obligatoires.`,
    ".haspad/requirements.md": `# Cahier des Charges

## Fonctionnalités obligatoires
1. [Fonctionnalité 1]
2. [Fonctionnalité 2]

## Parcours utilisateur
1. [Étape 1]
2. [Étape 2]
3. [Étape 3]

## Erreurs
- Réseau : état compréhensible.
- API 4xx/5xx : message utilisateur sans stack trace.
- Entrées invalides : validation côté client et serveur.

## Sécurité
- Aucun secret frontend.
- Validation serveur.
- Moindre privilège.

## Acceptation
Chaque fonctionnalité obligatoire doit être testable et le build doit respecter deployment.md.`,
    ".haspad/deployment.md": `# Règles de Déploiement HASPAD / Netlify

## Build
- Commande : [À définir]
- Publication : [À définir]
- Node : [À définir]

## Variables d'environnement
Lister uniquement les noms ; jamais les valeurs secrètes.
- [VARIABLE]

## Branche
HASPАD peut utiliser une branche de déploiement dédiée afin de préserver main.

## Vérifications
Build réussi, routes principales fonctionnelles, aucun secret dans le bundle client.

## Fallback
Si un agent IA échoue ou expire, HASPAD ne pousse pas le code instable. Le Build Hook Netlify peut redéployer la dernière version stable de la branche de déploiement.`
  };
}
