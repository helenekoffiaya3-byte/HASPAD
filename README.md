# HASPAD

HASPАD orchestre un projet GitHub avec trois rôles IA: Gemini pour l'interface, Claude pour le fonctionnement et ChatGPT pour l'audit final.

Flux: Google Auth -> projet -> connexion GitHub -> Deploy -> Gemini -> Claude -> ChatGPT -> branche isolée -> Pull Request -> CI.

La branche principale n'est jamais modifiée directement par le pipeline IA. Les secrets restent dans les variables Netlify.
