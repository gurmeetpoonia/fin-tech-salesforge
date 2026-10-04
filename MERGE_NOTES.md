# SalesForge merged project

This project combines the FIN-TECH and uptoskills project variants.

Merge policy:
- FIN-TECH was used as the base because it retains the fuller campaign scheduling/launch flow.
- UptoSkills additions were integrated where they add campaign auto-enrollment, sequence/workflow relations, and security fixes.
- Existing Prisma migration history was retained; the campaign sequence relation migration was added.
- Temporary `*_backup`, `*_old`, and generated database-dump artifacts were not copied into the source tree.
