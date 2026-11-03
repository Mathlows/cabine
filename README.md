# Cabine – facturation pour DJ

Application de facturation : profils, clients, catalogue, devis et factures numérotés en PDF, agenda relié à Google Agenda, envoi des factures depuis Gmail et page de prise de rendez-vous.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | L'application |
| `reserver.html` | Page publique de prise de rendez-vous |
| `web/` | Icônes, manifeste et cache pour l'installer sur le téléphone |
| `supabase/migrations/` | Tables de la base de données |
| `supabase/functions/google` | Envoi d'e-mails (Gmail) et synchronisation Google Agenda |
| `supabase/functions/booking` | Créneaux libres et demandes de rendez-vous |
| `.github/workflows/deploy.yml` | Mise en ligne automatique à chaque modification |

Aucune donnée personnelle (clients, factures) n'est stockée dans ce dépôt : elles sont dans la base Supabase, protégée par compte.

## Réglages GitHub nécessaires (Settings → Secrets and variables → Actions)

Variables : `SUPABASE_PROJECT_REF`

Secrets : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

GitHub Pages : Settings → Pages → Source : **GitHub Actions**.
