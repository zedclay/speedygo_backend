import {
  SUPPORT_FAQ_AUDIENCE_MERCHANT,
  SUPPORT_TOPIC_AUDIENCE_MERCHANT,
} from './support.policy';

export const SUPPORT_MERCHANT_SEED_VERSION = '2026-10-03';

export const SUPPORT_MERCHANT_TOPIC_SEED = [
  { code: 'ORDER_ISSUE', labelFr: 'Problème de commande', sortOrder: 10 },
  { code: 'PAYMENT_COD', labelFr: 'Paiement et espèces (COD)', sortOrder: 20 },
  { code: 'ACCOUNT_ACCESS', labelFr: 'Accès au compte', sortOrder: 30 },
  {
    code: 'CATALOGUE_TECH',
    labelFr: 'Catalogue ou problème technique',
    sortOrder: 40,
  },
  { code: 'OTHER', labelFr: 'Autre demande', sortOrder: 90 },
] as const;

/**
 * Factual FR copy only. No response-time (SLA), live-chat, phone-line or
 * approval-delay promises: the platform has none of those.
 */
export const SUPPORT_MERCHANT_FAQ_SEED = [
  {
    slug: 'verification-comment-ca-marche',
    titleFr: 'Comment fonctionne la vérification de mon compte ?',
    bodyFr: [
      'Pour être vérifié, vous complétez le dossier de votre établissement : le nom du commerce, les pièces demandées dans l’application et l’acceptation des conditions et de la déclaration d’exactitude.',
      'Une fois le dossier soumis, l’équipe SpeedyGo l’examine. Si tout est conforme, votre compte est approuvé.',
      'Si un point doit être corrigé, la raison s’affiche dans l’application : vous corrigez le dossier puis vous le soumettez de nouveau.',
      'Tant que votre compte n’est pas approuvé, certaines fonctions, comme la réception de commandes, restent indisponibles.',
    ].join('\n\n'),
    sortOrder: 10,
  },
  {
    slug: 'horaires-exceptionnels',
    titleFr: 'Comment fonctionnent les horaires exceptionnels ?',
    bodyFr: [
      'Un horaire exceptionnel s’applique à une seule date. Pour cette journée, il remplace vos horaires hebdomadaires.',
      'Vous pouvez marquer la journée comme fermée, ou indiquer jusqu’à 3 plages d’ouverture pour cette date.',
      'Pour plusieurs jours, créez un horaire exceptionnel par date.',
      'Vos horaires hebdomadaires doivent être définis avant d’ajouter un horaire exceptionnel. Une fermeture temporaire de la boutique reste prioritaire sur les horaires.',
    ].join('\n\n'),
    sortOrder: 20,
  },
  {
    slug: 'contacter-le-support',
    titleFr: 'Comment contacter le support SpeedyGo ?',
    bodyFr: [
      'Créez une demande depuis la section Support de l’application : choisissez un sujet, ajoutez un titre et décrivez votre situation. Vous pouvez lier une commande à votre demande.',
      'Les réponses de l’équipe apparaissent dans la conversation de votre demande, où vous pouvez aussi répondre. Seuls le propriétaire et les gestionnaires peuvent créer et consulter les demandes.',
      'Ne communiquez jamais de mot de passe ou de code de vérification dans une demande.',
    ].join('\n\n'),
    sortOrder: 30,
  },
] as const;

export const SUPPORT_MERCHANT_SEED_TOPIC_AUDIENCE =
  SUPPORT_TOPIC_AUDIENCE_MERCHANT;
export const SUPPORT_MERCHANT_SEED_FAQ_AUDIENCE = SUPPORT_FAQ_AUDIENCE_MERCHANT;
