import {
  EXISTING_VERTICALS,
  VERTICAL_BAKERIES_ID,
  VERTICAL_PHARMACIES_ID,
} from './ids.mjs';

const FICTIF =
  'Commerce fictif SpeedyGo — identité inventée pour la revue visuelle. Ne représente aucun commerce réel.';

function store(input) {
  return input;
}

function requiredSize(options) {
  return {
    name: 'Taille',
    required: true,
    minSelections: 1,
    maxSelections: 1,
    options,
  };
}

function requiredChoice(name, options) {
  return {
    name,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    options,
  };
}

function optionalExtras(options, max = 2) {
  return {
    name: 'Suppléments',
    required: false,
    minSelections: 0,
    maxSelections: max,
    options,
  };
}

export const NEW_VERTICALS = [
  {
    idKey: 'bakeries',
    id: VERTICAL_BAKERIES_ID,
    slug: 'review-bakeries',
    name: 'Boulangeries',
    iconKey: 'bakery_dining',
    sortOrder: 10,
  },
  {
    idKey: 'pharmacies',
    id: VERTICAL_PHARMACIES_ID,
    slug: 'review-pharmacies',
    name: 'Pharmacies',
    iconKey: 'medical_services',
    sortOrder: 11,
  },
];

/**
 * hours:
 *  - weekly: { days: [1-7], opens, closes }[]
 *  - empty: schedule row, no intervals (configured, always closed)
 *  - none: no schedule (unconfigured)
 */
export const STOREFRONTS = [
  store({
    n: 1,
    publicReference: 'sgm_review_01',
    merchantName: 'Dar El Bahja',
    branchName: 'Dar El Bahja',
    verticalId: EXISTING_VERTICALS.restaurants,
    phone: '+213550000101',
    addressText: `${FICTIF} 8 rue de la Casbah, Alger-Centre.`,
    latitude: 36.78512,
    longitude: 3.06041,
    hours: {
      kind: 'weekly',
      intervals: [{ days: [1, 2, 3, 4, 5, 6, 7], opens: 11 * 60, closes: 23 * 60 }],
    },
    hoursNote: 'Tous les jours 11:00–23:00',
    coverAsset: 'dar-el-bahja.jpg',
    menu: [
      {
        name: 'Plats',
        products: [
          {
            name: 'Couscous royal',
            description:
              'Semoule moyenne, poulet, agneau et pois chiches, servi avec son bouillon et raisins caramélisés.',
            priceMinor: 120000,
            options: [
              requiredSize([
                { name: 'Normale', additionalPriceMinor: 0 },
                { name: 'Grande', additionalPriceMinor: 20000 },
              ]),
              optionalExtras([
                { name: 'Cuisse supplémentaire', additionalPriceMinor: 25000 },
                { name: 'Harissa maison', additionalPriceMinor: 0 },
              ]),
            ],
          },
          {
            name: 'Couscous légumes',
            description:
              'Couscous aux légumes de saison, pois chiches et courge, sans viande.',
            priceMinor: 85000,
            options: [
              requiredSize([
                { name: 'Normale', additionalPriceMinor: 0 },
                { name: 'Grande', additionalPriceMinor: 15000 },
              ]),
            ],
          },
          {
            name: 'Poulet rôti',
            description:
              'Demi-poulet rôti aux herbes, pommes de terre et citron confit.',
            priceMinor: 95000,
            options: [
              optionalExtras([
                { name: 'Frites', additionalPriceMinor: 15000 },
                { name: 'Sauce blanche', additionalPriceMinor: 5000 },
              ]),
            ],
          },
        ],
      },
      {
        name: 'Entrées',
        products: [
          {
            name: 'Chorba frik',
            description:
              'Soupe de blé vert, tomate et coriandre, recette du vendredi.',
            priceMinor: 45000,
          },
          {
            name: 'Salade méchouia',
            description:
              'Poivrons et tomates grillés, huile d’olive et œuf dur.',
            priceMinor: 40000,
          },
        ],
      },
      {
        name: 'Boissons',
        products: [
          {
            name: 'Thé à la menthe',
            description: 'Thé vert gunpowder, menthe fraîche, servi très chaud.',
            priceMinor: 15000,
          },
          {
            name: 'Jus d’orange pressé',
            description: 'Oranges pressées à la commande, sans sucre ajouté.',
            priceMinor: 25000,
            options: [
              requiredSize([
                { name: 'Verre 25 cl', additionalPriceMinor: 0 },
                { name: 'Bouteille 50 cl', additionalPriceMinor: 15000 },
              ]),
            ],
          },
          {
            name: 'Eau minérale',
            description: 'Bouteille 50 cl, plate.',
            priceMinor: 10000,
          },
        ],
      },
    ],
  }),
  store({
    n: 2,
    publicReference: 'sgm_review_02',
    merchantName: 'Le Jardin d’El Biar',
    branchName: 'Le Jardin d’El Biar',
    verticalId: EXISTING_VERTICALS.restaurants,
    phone: '+213550000102',
    addressText: `${FICTIF} 14 chemin des Sources, El Biar.`,
    latitude: 36.76741,
    longitude: 3.02988,
    hours: {
      kind: 'weekly',
      intervals: [{ days: [1, 2, 3, 4, 5, 6], opens: 12 * 60, closes: 22 * 60 }],
    },
    hoursNote: 'Lundi–samedi 12:00–22:00 ; dimanche fermé',
    coverAsset: 'jardin-el-biar.jpg',
    menu: [
      {
        name: 'Entrées',
        products: [
          {
            name: 'Salade du jardin',
            description:
              'Mesclun, concombre, tomates cerises, noix et vinaigrette citron.',
            priceMinor: 55000,
            options: [
              optionalExtras([
                { name: 'Fromage de chèvre', additionalPriceMinor: 20000 },
                { name: 'Avocat', additionalPriceMinor: 15000 },
              ]),
            ],
          },
          {
            name: 'Soupe du jour',
            description: 'Velouté de légumes du marché, servi avec croûtons.',
            priceMinor: 40000,
          },
        ],
      },
      {
        name: 'Plats',
        products: [
          {
            name: 'Daurade grillée',
            description:
              'Daurade entière, fenouil et citron, accompagnée de riz pilaf.',
            priceMinor: 140000,
            options: [
              requiredChoice('Cuisson', [
                { name: 'Rosé', additionalPriceMinor: 0 },
                { name: 'À cœur', additionalPriceMinor: 0 },
              ]),
            ],
          },
          {
            name: 'Pâtes aux légumes',
            description: 'Tagliatelles, courgettes, tomates confites et basilic.',
            priceMinor: 80000,
          },
          {
            name: 'Filet de dinde',
            description: 'Dinde rôtie, jus léger et légumes glacés.',
            priceMinor: 110000,
          },
        ],
      },
      {
        name: 'Desserts et boissons',
        products: [
          {
            name: 'Tarte du jour',
            description: 'Pâte sablée et fruits selon l’arrivage.',
            priceMinor: 45000,
          },
          {
            name: 'Café allongé',
            description: 'Arabica, servi en tasse.',
            priceMinor: 20000,
          },
          {
            name: 'Eau plate',
            description: 'Bouteille 50 cl.',
            priceMinor: 10000,
          },
        ],
      },
    ],
  }),
  store({
    n: 3,
    publicReference: 'sgm_review_03',
    merchantName: 'Grillade des Oliviers',
    branchName: 'Grillade des Oliviers',
    verticalId: EXISTING_VERTICALS.restaurants,
    phone: '+213550000103',
    addressText: `${FICTIF} 27 boulevard des Oliviers, Bir Mourad Raïs.`,
    latitude: 36.73722,
    longitude: 3.05019,
    hours: {
      kind: 'weekly',
      intervals: [
        {
          days: [1, 2, 3, 4, 5, 6, 7],
          opens: 18 * 60,
          closes: 60,
          closesNextDay: true,
        },
      ],
    },
    hoursNote: 'Tous les jours 18:00–01:00 (service de nuit)',
    coverAsset: 'grillade-oliviers.jpg',
    menu: [
      {
        name: 'Grillades',
        products: [
          {
            name: 'Brochettes d’agneau',
            description: 'Quatre brochettes marinées, oignon et sumac.',
            priceMinor: 130000,
            options: [
              requiredChoice('Cuisson', [
                { name: 'Saignant', additionalPriceMinor: 0 },
                { name: 'À point', additionalPriceMinor: 0 },
                { name: 'Bien cuit', additionalPriceMinor: 0 },
              ]),
              optionalExtras([
                { name: 'Sauce grillage', additionalPriceMinor: 0 },
                { name: 'Harissa', additionalPriceMinor: 0 },
              ]),
            ],
          },
          {
            name: 'Brochettes de poulet',
            description: 'Poulet mariné au citron et paprika, grillé à la braise.',
            priceMinor: 95000,
            options: [
              requiredChoice('Cuisson', [
                { name: 'Juteux', additionalPriceMinor: 0 },
                { name: 'Bien cuit', additionalPriceMinor: 0 },
              ]),
            ],
          },
          {
            name: 'Kefta grillée',
            description: 'Boulettes d’agneau aux herbes, tomate grillée.',
            priceMinor: 90000,
          },
          {
            name: 'Côtes d’agneau',
            description: 'Côtes persillées, sel de mer et thym.',
            priceMinor: 150000,
            options: [
              requiredChoice('Cuisson', [
                { name: 'Saignant', additionalPriceMinor: 0 },
                { name: 'À point', additionalPriceMinor: 0 },
                { name: 'Bien cuit', additionalPriceMinor: 0 },
              ]),
            ],
          },
          {
            name: 'Assiette mixte',
            description:
              'Agneau, poulet et kefta, pour deux personnes environ.',
            priceMinor: 180000,
          },
        ],
      },
      {
        name: 'Accompagnements',
        products: [
          {
            name: 'Frites maison',
            description: 'Pommes de terre coupées minute, sel.',
            priceMinor: 30000,
          },
          {
            name: 'Pain maison',
            description: 'Kesra chaude, une pièce.',
            priceMinor: 10000,
          },
        ],
      },
      {
        name: 'Boissons',
        products: [
          {
            name: 'Boisson gazeuse',
            description: 'Canette 33 cl, au choix du stock.',
            priceMinor: 15000,
          },
        ],
      },
    ],
  }),
  store({
    n: 4,
    publicReference: 'sgm_review_04',
    merchantName: 'Four de Didouche',
    branchName: 'Four de Didouche',
    verticalId: VERTICAL_BAKERIES_ID,
    phone: '+213550000104',
    addressText: `${FICTIF} 56 rue Didouche Mourad, Alger-Centre.`,
    latitude: 36.76955,
    longitude: 3.05502,
    hours: {
      kind: 'weekly',
      intervals: [{ days: [1, 2, 3, 4, 5, 6, 7], opens: 6 * 60 + 30, closes: 20 * 60 }],
    },
    hoursNote: 'Tous les jours 06:30–20:00',
    coverAsset: 'four-didouche.jpg',
    menu: [
      {
        name: 'Pains',
        products: [
          {
            name: 'Baguette tradition',
            description: 'Farine T65, croûte dorée, 250 g environ.',
            priceMinor: 20000,
          },
          {
            name: 'Pain khobz',
            description: 'Pain rond à mie dense, four à sole.',
            priceMinor: 25000,
          },
        ],
      },
      {
        name: 'Viennoiseries',
        products: [
          {
            name: 'Croissant au beurre',
            description: 'Pâte feuilletée, beurre, cuit le matin.',
            priceMinor: 40000,
          },
          {
            name: 'Pain au chocolat',
            description: 'Deux barres de chocolat, pâte levée feuilletée.',
            priceMinor: 45000,
          },
          {
            name: 'Cookies',
            description: 'Sablé chocolat, la pièce.',
            priceMinor: 30000,
          },
        ],
      },
      {
        name: 'Snacks',
        products: [
          {
            name: 'Sandwich thon',
            description: 'Thon, œuf, laitue et citron, pain du jour.',
            priceMinor: 35000,
            options: [
              requiredChoice('Pain', [
                { name: 'Baguette', additionalPriceMinor: 0 },
                { name: 'Khobz', additionalPriceMinor: 0 },
              ]),
              optionalExtras([{ name: 'Fromage', additionalPriceMinor: 10000 }]),
            ],
          },
          {
            name: 'Part de cake citron',
            description: 'Cake moelleux, zeste et glaçage léger.',
            priceMinor: 50000,
          },
          {
            name: 'Café',
            description: 'Expresso serré.',
            priceMinor: 15000,
            options: [
              requiredSize([
                { name: 'Simple', additionalPriceMinor: 0 },
                { name: 'Allongé', additionalPriceMinor: 5000 },
              ]),
            ],
          },
        ],
      },
    ],
  }),
  store({
    n: 5,
    publicReference: 'sgm_review_05',
    merchantName: 'Maison du Blé',
    branchName: 'Maison du Blé',
    verticalId: VERTICAL_BAKERIES_ID,
    phone: '+213550000105',
    addressText: `${FICTIF} 3 rue des Frères Mahieddine, Hydra.`,
    latitude: 36.74891,
    longitude: 3.04122,
    hours: {
      kind: 'weekly',
      intervals: [{ days: [1, 2, 3, 4, 5, 6, 7], opens: 7 * 60, closes: 19 * 60 }],
    },
    hoursNote: 'Tous les jours 07:00–19:00',
    coverAsset: 'maison-du-ble.jpg',
    menu: [
      {
        name: 'Pains du pays',
        products: [
          {
            name: 'Kesra',
            description: 'Galette de semoule cuite à la tajine, encore tiède.',
            priceMinor: 25000,
          },
          {
            name: 'Matloue',
            description: 'Pain levain, mie alvéolée, farine locale.',
            priceMinor: 30000,
          },
          {
            name: 'Msemen',
            description: 'Feuilleté griddle, à tartiner ou à farcir.',
            priceMinor: 35000,
            options: [
              requiredChoice('Finition', [
                { name: 'Nature', additionalPriceMinor: 0 },
                { name: 'Miel', additionalPriceMinor: 10000 },
              ]),
            ],
          },
          {
            name: 'Baguette',
            description: 'Baguette blanche, 200 g.',
            priceMinor: 20000,
          },
        ],
      },
      {
        name: 'Douceurs',
        products: [
          {
            name: 'Assortiment viennoiseries',
            description: 'Trois pièces du matin : croissant, pain au lait, chausson.',
            priceMinor: 60000,
          },
          {
            name: 'Sablés',
            description: 'Sablés à l’huile, sachet de 200 g.',
            priceMinor: 40000,
          },
        ],
      },
      {
        name: 'Épicerie de four',
        products: [
          {
            name: 'Lait 1 L',
            description: 'Brique UHT, pour le petit-déjeuner.',
            priceMinor: 20000,
          },
        ],
      },
    ],
  }),
  store({
    n: 6,
    publicReference: 'sgm_review_06',
    merchantName: 'Souk El Khemis',
    branchName: 'Souk El Khemis',
    verticalId: EXISTING_VERTICALS.groceries,
    phone: '+213550000106',
    addressText: `${FICTIF} 19 rue du Marché, Kouba. Ouverture 24 h (épicerie de nuit fictive).`,
    latitude: 36.72844,
    longitude: 3.08671,
    hours: {
      kind: 'weekly',
      intervals: [
        {
          days: [1, 2, 3, 4, 5, 6, 7],
          opens: 0,
          closes: 0,
          closesNextDay: true,
        },
      ],
    },
    hoursNote: '24 h / 24 (00:00–00:00 lendemain)',
    coverAsset: 'souk-el-khemis.jpg',
    menu: [
      {
        name: 'Frais',
        products: [
          {
            name: 'Tomates 1 kg',
            description: 'Tomates de saison, calibrage mélange.',
            priceMinor: 25000,
          },
          {
            name: 'Œufs x12',
            description: 'Boîte de douze œufs, calibre moyen.',
            priceMinor: 36000,
          },
          {
            name: 'Dattes Deglet Nour 250 g',
            description: 'Dattes charnues, barquette.',
            priceMinor: 45000,
            options: [
              optionalExtras(
                [{ name: 'Barquette supplémentaire 250 g', additionalPriceMinor: 45000 }],
                1,
              ),
            ],
          },
        ],
      },
      {
        name: 'Épicerie',
        products: [
          {
            name: 'Huile de tournesol 1 L',
            description: 'Bouteille plastique, première pression industrielle.',
            priceMinor: 28000,
          },
          {
            name: 'Couscous moyen 1 kg',
            description: 'Semoule de blé dur, grain moyen.',
            priceMinor: 22000,
          },
          {
            name: 'Miel 250 g',
            description: 'Miel toutes fleurs, pot verre.',
            priceMinor: 65000,
          },
        ],
      },
      {
        name: 'Boissons',
        products: [
          {
            name: 'Lait 1 L',
            description: 'Lait demi-écrémé UHT.',
            priceMinor: 18000,
          },
          {
            name: 'Pack d’eau 6 × 1,5 L',
            description: 'Eau de source, fardelage.',
            priceMinor: 40000,
          },
        ],
      },
    ],
  }),
  store({
    n: 7,
    publicReference: 'sgm_review_07',
    merchantName: 'Épicerie du Parc',
    branchName: 'Épicerie du Parc',
    verticalId: EXISTING_VERTICALS.groceries,
    phone: '+213550000107',
    addressText: `${FICTIF} 4 allée du Parc, Ben Aknoun. Horaires configurés sans créneau : toujours fermée.`,
    latitude: 36.75802,
    longitude: 3.01145,
    hours: { kind: 'empty' },
    hoursNote:
      'CAS DOCUMENTÉ — schedule présent, aucun intervalle : hoursConfigured=true, isOpenNow=false',
    coverAsset: 'epicerie-du-parc.jpg',
    menu: [
      {
        name: 'Sec',
        products: [
          {
            name: 'Pâtes 500 g',
            description: 'Spaghetti blé dur.',
            priceMinor: 15000,
          },
          {
            name: 'Riz 1 kg',
            description: 'Riz long grain.',
            priceMinor: 22000,
          },
          {
            name: 'Sucre 1 kg',
            description: 'Sucre blanc cristallisé.',
            priceMinor: 14000,
          },
          {
            name: 'Farine 1 kg',
            description: 'Farine de blé T55.',
            priceMinor: 16000,
          },
        ],
      },
      {
        name: 'Petit-déjeuner',
        products: [
          {
            name: 'Café moulu 250 g',
            description: 'Mélange arabica-robusta, mouture espresso.',
            priceMinor: 55000,
          },
          {
            name: 'Confiture d’abricot',
            description: 'Pot 370 g, fruits et sucre.',
            priceMinor: 35000,
          },
          {
            name: 'Fromage 200 g',
            description: 'Fromage à pâte pressée, portion.',
            priceMinor: 48000,
          },
        ],
      },
    ],
  }),
  store({
    n: 8,
    publicReference: 'sgm_review_08',
    merchantName: 'Pharmacie Atlas',
    branchName: 'Pharmacie Atlas',
    verticalId: VERTICAL_PHARMACIES_ID,
    phone: '+213550000108',
    addressText: `${FICTIF} 11 rue des Pins, Hussein Dey. Pharmacie de garde fictive, 24 h.`,
    latitude: 36.74418,
    longitude: 3.10233,
    hours: {
      kind: 'weekly',
      intervals: [
        {
          days: [1, 2, 3, 4, 5, 6, 7],
          opens: 0,
          closes: 0,
          closesNextDay: true,
        },
      ],
    },
    hoursNote: '24 h / 24 (pharmacie de garde fictive)',
    coverAsset: 'pharmacie-atlas.jpg',
    menu: [
      {
        name: 'Soins courants',
        products: [
          {
            name: 'Paracétamol 500 mg',
            description:
              'Boîte de 16 comprimés, usage ponctuel. Demander conseil au pharmacien.',
            priceMinor: 18000,
          },
          {
            name: 'Vitamine C',
            description: 'Complément alimentaire, 20 doses.',
            priceMinor: 45000,
            options: [
              requiredChoice('Forme', [
                { name: 'Comprimés', additionalPriceMinor: 0 },
                { name: 'Effervescent', additionalPriceMinor: 5000 },
              ]),
            ],
          },
          {
            name: 'Pansements assortis',
            description: 'Boîte de 20 pansements stériles.',
            priceMinor: 15000,
          },
          {
            name: 'Sérum physiologique',
            description: 'Unidose 5 ml, boîte de 10.',
            priceMinor: 12000,
          },
        ],
      },
      {
        name: 'Parapharmacie',
        products: [
          {
            name: 'Crème solaire SPF 50',
            description: 'Tube 50 ml, visage et corps.',
            priceMinor: 120000,
          },
          {
            name: 'Thermomètre digital',
            description: 'Mesure axillaire, boîtier inclus.',
            priceMinor: 85000,
          },
          {
            name: 'Dentifrice',
            description: 'Tube 75 ml, fluor.',
            priceMinor: 25000,
          },
          {
            name: 'Gel hydroalcoolique',
            description: 'Flacon 100 ml.',
            priceMinor: 22000,
          },
        ],
      },
    ],
  }),
  store({
    n: 9,
    publicReference: 'sgm_review_09',
    merchantName: 'Glaces du Palmier',
    branchName: 'Glaces du Palmier',
    verticalId: EXISTING_VERTICALS.desserts,
    phone: '+213550000109',
    addressText: `${FICTIF} 22 chemin Sidi Yahia, Hydra.`,
    latitude: 36.74633,
    longitude: 3.03488,
    hours: {
      kind: 'weekly',
      intervals: [{ days: [1, 2, 3, 4, 5, 6, 7], opens: 10 * 60, closes: 23 * 60 }],
    },
    hoursNote: 'Tous les jours 10:00–23:00',
    coverAsset: 'glaces-du-palmier.jpg',
    menu: [
      {
        name: 'Glaces',
        products: [
          {
            name: 'Cornet 2 boules',
            description: 'Cornet croustillant, deux parfums au choix.',
            priceMinor: 35000,
            options: [
              {
                name: 'Parfums',
                required: true,
                minSelections: 1,
                maxSelections: 2,
                options: [
                  { name: 'Vanille', additionalPriceMinor: 0 },
                  { name: 'Chocolat', additionalPriceMinor: 0 },
                  { name: 'Fraise', additionalPriceMinor: 0 },
                  { name: 'Pistache', additionalPriceMinor: 5000 },
                ],
              },
            ],
          },
          {
            name: 'Coupe 3 boules',
            description: 'Coupe, chantilly possible en supplément.',
            priceMinor: 50000,
            options: [
              {
                name: 'Parfums',
                required: true,
                minSelections: 1,
                maxSelections: 3,
                options: [
                  { name: 'Vanille', additionalPriceMinor: 0 },
                  { name: 'Chocolat', additionalPriceMinor: 0 },
                  { name: 'Fraise', additionalPriceMinor: 0 },
                  { name: 'Pistache', additionalPriceMinor: 5000 },
                ],
              },
              optionalExtras([{ name: 'Chantilly', additionalPriceMinor: 10000 }], 1),
            ],
          },
          {
            name: 'Sundae chocolat',
            description: 'Glace vanille, sauce chocolat et éclats de gaufrette.',
            priceMinor: 55000,
          },
          {
            name: 'Granité citron',
            description: 'Glace pilée au citron, très froid.',
            priceMinor: 25000,
          },
        ],
      },
      {
        name: 'Boissons glacées',
        products: [
          {
            name: 'Milk-shake',
            description: 'Lait, glace vanille, servi grand verre.',
            priceMinor: 45000,
            options: [
              requiredChoice('Parfum', [
                { name: 'Vanille', additionalPriceMinor: 0 },
                { name: 'Chocolat', additionalPriceMinor: 0 },
                { name: 'Fraise', additionalPriceMinor: 5000 },
              ]),
            ],
          },
          {
            name: 'Affogato',
            description: 'Boule de vanille nappée d’expresso chaud.',
            priceMinor: 40000,
          },
        ],
      },
      {
        name: 'Boissons',
        products: [
          {
            name: 'Café',
            description: 'Expresso.',
            priceMinor: 20000,
          },
          {
            name: 'Eau',
            description: 'Bouteille 50 cl.',
            priceMinor: 10000,
          },
        ],
      },
    ],
  }),
  store({
    n: 10,
    publicReference: 'sgm_review_10',
    merchantName: 'Atelier Sucré',
    branchName: 'Atelier Sucré',
    verticalId: EXISTING_VERTICALS.desserts,
    phone: '+213550000110',
    addressText: `${FICTIF} 9 rue des Jardins, Hydra. Aucun horaire configuré.`,
    latitude: 36.75108,
    longitude: 3.03891,
    hours: { kind: 'none' },
    hoursNote:
      'CAS DOCUMENTÉ — pas de MerchantBranchOpeningSchedule : hoursConfigured=false',
    coverAsset: 'atelier-sucre.jpg',
    menu: [
      {
        name: 'Pâtisseries',
        products: [
          {
            name: 'Tarte aux fruits',
            description: 'Pâte sablée, crème pâtissière et fruits vitrifiés.',
            priceMinor: 45000,
          },
          {
            name: 'Éclair au chocolat',
            description: 'Pâte à choux, crème chocolat, fondant.',
            priceMinor: 35000,
          },
          {
            name: 'Boîte de macarons',
            description: 'Coques amande, ganaches assorties.',
            priceMinor: 120000,
            options: [
              requiredSize([
                { name: '6 pièces', additionalPriceMinor: 0 },
                { name: '12 pièces', additionalPriceMinor: 80000 },
              ]),
            ],
          },
          {
            name: 'Cheesecake',
            description: 'Part individuelle, coulis fruits rouges.',
            priceMinor: 55000,
          },
          {
            name: 'Brownie',
            description: 'Chocolat noir, noix, part généreuse.',
            priceMinor: 30000,
          },
          {
            name: 'Tiramisu',
            description: 'Mascarpone, café et cacao, verrine.',
            priceMinor: 50000,
          },
          {
            name: 'Baklava',
            description: 'Feuilles, amandes et miel, deux losanges.',
            priceMinor: 40000,
          },
        ],
      },
      {
        name: 'Boissons',
        products: [
          {
            name: 'Thé',
            description: 'Thé noir, citron en option au comptoir.',
            priceMinor: 15000,
          },
        ],
      },
    ],
  }),
];
