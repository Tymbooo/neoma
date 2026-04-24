/** Base taxonomy / biology questions (shared with original design). */
export const BASE_TRAIT_QUESTIONS = {
  mammal: "Is it a mammal?",
  bird: "Is it a bird?",
  reptile: "Is it a reptile?",
  fish: "Is it a fish?",
  insect: "Is it an insect?",
  amphibian: "Is it an amphibian?",
  aquatic: "Does it live mainly in water?",
  can_fly: "Can it fly?",
  fur: "Does it have fur or hair?",
  feathers: "Does it have feathers?",
  lays_eggs: "Does it lay eggs (usual reproduction)?",
  carnivore: "Is it mainly carnivorous?",
  herbivore: "Is it mainly herbivorous?",
  four_legs: "Does it characteristically have four legs?",
  farm_domestic: "Is it a common farm or domestic animal?",
  warm_blooded: "Is it warm-blooded?",
  vertebrate: "Is it a vertebrate?",
  nocturnal: "Is it mainly nocturnal?",
  large: "Is it generally large (bigger than a big dog)?",
  stripes_or_spots: "Does it often have obvious stripes or spots?",
};

/** Extra morphology / ecology traits (sparse per species). */
export const EXTENDED_TRAIT_QUESTIONS = {
  ext_wings_or_beak: "Does it have wings or a prominent beak?",
  ext_cold_blooded: "Is it cold-blooded?",
  ext_six_plus_legs: "Does it have six or more legs?",
  ext_obvious_stripes: "Does it usually show bold stripes (not just freckling)?",
  ext_long_neck: "Does it have a noticeably long neck compared to its body?",
  ext_hooves: "Does it have hooves?",
  ext_echolocation: "Does it use echolocation to navigate or hunt?",
  ext_venom_or_sting: "Is it notably venomous or stinging?",
  ext_flippers: "Does it have flippers suited for swimming?",
  ext_mane: "Does it have a prominent mane?",
  ext_big_outer_ears: "Does it have large, obvious outer ears?",
  ext_burrows: "Is it strongly associated with burrowing or digging dens?",
  ext_obvious_spots: "Does it often have large obvious spots or blotches?",
  ext_trunk: "Does it have a trunk?",
  ext_horns_or_antlers: "Does it have horns or antlers?",
  ext_prominent_whiskers: "Does it have very prominent whiskers or vibrissae?",
  ext_many_arms_tentacles: "Does it have many arms or tentacles (more than four limbs)?",
  ext_silk_or_web: "Does it make silk or capture webs?",
  ext_hard_shell: "Does it have a hard external shell people notice?",
  ext_body_scales: "Does it have obvious body scales?",
  ext_hopping: "Does it move mainly by hopping or jumping?",
  ext_tusks: "Does it have prominent tusks or long exposed ivory?",
  ext_webbed_feet: "Does it have webbed feet?",
  ext_mostly_bare_skin: "Is most of its body bare skin (little fur or feathers)?",
  ext_prehensile_tail: "Does it have a prehensile (grasping) tail?",
  ext_obvious_teeth: "Does it usually show obvious large teeth or fangs?",
};

/** Subjective / cultural overlap traits (for softer splits). */
export const SOFT_TRAIT_QUESTIONS = {
  soft_kids_icon: "Is it often a kids’ cartoon or mascot icon?",
  soft_savanna: "Is it strongly associated with savanna or open plains?",
  soft_forests: "Is it strongly associated with forests or woodlands?",
  soft_ocean_star: "Is it a common ocean documentary star?",
  soft_creepy: "Does it have a strong creepy or spooky reputation?",
  soft_herd: "Does it usually live in herds, flocks, or large colonies?",
};

const EXT_KEYS = Object.keys(EXTENDED_TRAIT_QUESTIONS);
const SOFT_KEYS = Object.keys(SOFT_TRAIT_QUESTIONS);
export const BASE_KEYS = Object.keys(BASE_TRAIT_QUESTIONS);

/**
 * Base rows: only keys from BASE_TRAIT_QUESTIONS; omit false.
 * warm_blooded / vertebrate can be set false for invertebrates.
 */
export const ANIMALS_RAW = [
  { id: "lion", name: "Lion", mammal: true, carnivore: true, fur: true, four_legs: true, large: true },
  { id: "tiger", name: "Tiger", mammal: true, carnivore: true, fur: true, four_legs: true, large: true, stripes_or_spots: true },
  { id: "elephant", name: "Elephant", mammal: true, herbivore: true, four_legs: true, large: true },
  { id: "giraffe", name: "Giraffe", mammal: true, herbivore: true, fur: true, four_legs: true, large: true, stripes_or_spots: true },
  { id: "zebra", name: "Zebra", mammal: true, herbivore: true, fur: true, four_legs: true, large: true, stripes_or_spots: true },
  { id: "bear", name: "Bear", mammal: true, carnivore: true, fur: true, four_legs: true, large: true },
  { id: "wolf", name: "Wolf", mammal: true, carnivore: true, fur: true, four_legs: true },
  { id: "fox", name: "Fox", mammal: true, carnivore: true, fur: true, four_legs: true },
  { id: "rabbit", name: "Rabbit", mammal: true, herbivore: true, fur: true, four_legs: true, farm_domestic: true },
  { id: "mouse", name: "Mouse", mammal: true, herbivore: true, fur: true, four_legs: true, nocturnal: true },
  { id: "horse", name: "Horse", mammal: true, herbivore: true, fur: true, four_legs: true, large: true, farm_domestic: true },
  { id: "cow", name: "Cow", mammal: true, herbivore: true, fur: true, four_legs: true, large: true, farm_domestic: true },
  { id: "pig", name: "Pig", mammal: true, herbivore: true, fur: false, four_legs: true, farm_domestic: true },
  { id: "sheep", name: "Sheep", mammal: true, herbivore: true, fur: true, four_legs: true, farm_domestic: true },
  { id: "dog", name: "Dog", mammal: true, carnivore: true, fur: true, four_legs: true, farm_domestic: true },
  { id: "cat", name: "Cat", mammal: true, carnivore: true, fur: true, four_legs: true, farm_domestic: true, nocturnal: true },
  { id: "dolphin", name: "Dolphin", mammal: true, carnivore: true, aquatic: true, large: true },
  { id: "whale", name: "Whale", mammal: true, carnivore: true, aquatic: true, large: true },
  { id: "bat", name: "Bat", mammal: true, carnivore: true, can_fly: true, fur: true, nocturnal: true },
  { id: "eagle", name: "Eagle", bird: true, carnivore: true, feathers: true, can_fly: true, lays_eggs: true },
  { id: "penguin", name: "Penguin", bird: true, carnivore: true, feathers: true, aquatic: true, lays_eggs: true },
  { id: "owl", name: "Owl", bird: true, carnivore: true, feathers: true, can_fly: true, lays_eggs: true, nocturnal: true },
  { id: "chicken", name: "Chicken", bird: true, feathers: true, lays_eggs: true, farm_domestic: true },
  { id: "duck", name: "Duck", bird: true, feathers: true, lays_eggs: true, aquatic: true, can_fly: true, farm_domestic: true },
  { id: "crocodile", name: "Crocodile", reptile: true, carnivore: true, aquatic: true, lays_eggs: true, four_legs: true, large: true },
  { id: "snake", name: "Snake", reptile: true, carnivore: true, lays_eggs: true },
  { id: "turtle", name: "Turtle", reptile: true, aquatic: true, lays_eggs: true, four_legs: true },
  { id: "frog", name: "Frog", amphibian: true, carnivore: true, lays_eggs: true, aquatic: true, four_legs: true },
  { id: "salmon", name: "Salmon", fish: true, aquatic: true, lays_eggs: true },
  { id: "shark", name: "Shark", fish: true, carnivore: true, aquatic: true, large: true },
  { id: "octopus", name: "Octopus", fish: false, carnivore: true, aquatic: true, lays_eggs: true, warm_blooded: false, vertebrate: false },
  { id: "bee", name: "Bee", insect: true, can_fly: true, lays_eggs: true },
  { id: "ant", name: "Ant", insect: true, lays_eggs: true },
  { id: "spider", name: "Spider", insect: false, carnivore: true, lays_eggs: true, warm_blooded: false, vertebrate: false },
  { id: "deer", name: "Deer", mammal: true, herbivore: true, fur: true, four_legs: true, large: true },
  { id: "hippo", name: "Hippopotamus", mammal: true, herbivore: true, aquatic: true, four_legs: true, large: true },
  { id: "kangaroo", name: "Kangaroo", mammal: true, herbivore: true, fur: true, large: true },
  { id: "gorilla", name: "Gorilla", mammal: true, herbivore: true, fur: true, four_legs: true, large: true },
  { id: "rhinoceros", name: "Rhinoceros", mammal: true, herbivore: true, fur: false, four_legs: true, large: true },
  { id: "camel", name: "Camel", mammal: true, herbivore: true, fur: true, four_legs: true, large: true },
  { id: "cheetah", name: "Cheetah", mammal: true, carnivore: true, fur: true, four_legs: true, large: true, stripes_or_spots: true },
  { id: "seal", name: "Seal", mammal: true, carnivore: true, aquatic: true, fur: false, four_legs: false },
  { id: "walrus", name: "Walrus", mammal: true, carnivore: true, aquatic: true, large: true, fur: false, four_legs: false },
  { id: "otter", name: "Otter", mammal: true, carnivore: true, aquatic: true, fur: true, four_legs: true },
  { id: "moose", name: "Moose", mammal: true, herbivore: true, fur: true, four_legs: true, large: true },
  { id: "bison", name: "Bison", mammal: true, herbivore: true, fur: true, four_legs: true, large: true },
  { id: "parrot", name: "Parrot", bird: true, herbivore: true, feathers: true, can_fly: true, lays_eggs: true },
  { id: "flamingo", name: "Flamingo", bird: true, herbivore: true, feathers: true, lays_eggs: true, aquatic: true, can_fly: true },
  { id: "raccoon", name: "Raccoon", mammal: true, carnivore: true, fur: true, four_legs: true, nocturnal: true },
  { id: "squirrel", name: "Squirrel", mammal: true, herbivore: true, fur: true, four_legs: true },
  { id: "squid", name: "Squid", fish: false, carnivore: true, aquatic: true, warm_blooded: false, vertebrate: false },
];

/**
 * Sparse extended + soft traits that are true for each id.
 * All other extended/soft keys default false.
 */
export const EXT_AND_SOFT_TRUE = {
  lion: ["ext_mane", "ext_obvious_teeth", "ext_big_outer_ears", "soft_kids_icon", "soft_savanna", "soft_herd"],
  tiger: ["ext_obvious_stripes", "ext_obvious_teeth", "ext_big_outer_ears", "soft_kids_icon", "soft_forests", "soft_creepy"],
  elephant: ["ext_trunk", "ext_tusks", "ext_obvious_teeth", "ext_big_outer_ears", "ext_long_neck", "soft_kids_icon", "soft_savanna", "soft_herd"],
  giraffe: ["ext_long_neck", "ext_hooves", "ext_obvious_spots", "soft_kids_icon", "soft_savanna", "soft_herd"],
  zebra: ["ext_obvious_stripes", "ext_hooves", "soft_kids_icon", "soft_savanna", "soft_herd"],
  bear: ["ext_obvious_teeth", "ext_big_outer_ears", "soft_kids_icon", "soft_forests", "soft_creepy"],
  wolf: ["ext_obvious_teeth", "ext_big_outer_ears", "soft_forests", "soft_herd", "soft_creepy"],
  fox: ["ext_big_outer_ears", "soft_kids_icon", "soft_forests"],
  rabbit: ["ext_big_outer_ears", "ext_hopping", "soft_kids_icon", "soft_herd"],
  mouse: ["ext_big_outer_ears", "ext_burrows", "soft_kids_icon", "soft_creepy", "soft_herd"],
  horse: ["ext_hooves", "ext_mane", "ext_big_outer_ears", "soft_kids_icon", "soft_herd"],
  cow: ["ext_hooves", "ext_big_outer_ears", "soft_herd"],
  pig: ["ext_obvious_teeth", "ext_burrows"],
  sheep: ["ext_hooves", "soft_herd"],
  dog: ["ext_big_outer_ears", "ext_obvious_teeth", "soft_kids_icon"],
  cat: ["ext_prominent_whiskers", "ext_big_outer_ears", "ext_obvious_teeth", "soft_kids_icon", "soft_creepy"],
  dolphin: ["ext_flippers", "ext_echolocation", "ext_mostly_bare_skin", "soft_kids_icon", "soft_ocean_star", "soft_herd"],
  whale: ["ext_flippers", "ext_mostly_bare_skin", "soft_kids_icon", "soft_ocean_star", "soft_herd"],
  bat: ["ext_wings_or_beak", "ext_big_outer_ears", "soft_creepy", "soft_herd"],
  eagle: ["ext_wings_or_beak", "ext_obvious_teeth", "soft_kids_icon", "soft_forests"],
  penguin: ["ext_wings_or_beak", "ext_flippers", "soft_kids_icon", "soft_ocean_star", "soft_herd"],
  owl: ["ext_wings_or_beak", "ext_big_outer_ears", "soft_kids_icon", "soft_forests", "soft_creepy"],
  chicken: ["ext_wings_or_beak", "soft_kids_icon", "soft_herd"],
  duck: ["ext_wings_or_beak", "ext_webbed_feet", "soft_kids_icon", "soft_herd"],
  crocodile: ["ext_cold_blooded", "ext_body_scales", "ext_obvious_teeth", "soft_ocean_star", "soft_creepy", "soft_herd"],
  snake: ["ext_cold_blooded", "ext_body_scales", "soft_creepy"],
  turtle: ["ext_cold_blooded", "ext_hard_shell", "soft_kids_icon", "soft_ocean_star"],
  frog: ["ext_cold_blooded", "ext_hopping", "ext_webbed_feet", "soft_kids_icon", "soft_creepy"],
  salmon: ["ext_cold_blooded", "ext_body_scales", "soft_ocean_star", "soft_herd"],
  shark: ["ext_cold_blooded", "ext_body_scales", "ext_obvious_teeth", "soft_ocean_star", "soft_creepy", "soft_herd"],
  octopus: ["ext_cold_blooded", "ext_many_arms_tentacles", "soft_ocean_star", "soft_creepy"],
  bee: ["ext_cold_blooded", "ext_wings_or_beak", "ext_six_plus_legs", "ext_venom_or_sting", "soft_herd"],
  ant: ["ext_cold_blooded", "ext_six_plus_legs", "ext_burrows", "soft_herd", "soft_creepy"],
  spider: ["ext_cold_blooded", "ext_six_plus_legs", "ext_silk_or_web", "ext_venom_or_sting", "soft_creepy"],
  deer: ["ext_hooves", "ext_horns_or_antlers", "soft_forests", "soft_herd"],
  hippo: ["ext_obvious_teeth", "ext_mostly_bare_skin", "soft_kids_icon", "soft_savanna", "soft_herd"],
  kangaroo: ["ext_hopping", "ext_big_outer_ears", "soft_kids_icon", "soft_savanna", "soft_herd"],
  gorilla: ["ext_big_outer_ears", "soft_kids_icon", "soft_forests", "soft_herd"],
  rhinoceros: ["ext_horns_or_antlers", "ext_mostly_bare_skin", "soft_kids_icon", "soft_savanna", "soft_herd"],
  camel: ["ext_hooves", "ext_long_neck", "soft_kids_icon", "soft_savanna", "soft_herd"],
  cheetah: ["ext_obvious_spots", "ext_obvious_teeth", "soft_savanna", "soft_creepy"],
  seal: ["ext_flippers", "ext_big_outer_ears", "soft_kids_icon", "soft_ocean_star", "soft_herd"],
  walrus: ["ext_flippers", "ext_tusks", "ext_prominent_whiskers", "ext_mostly_bare_skin", "soft_ocean_star", "soft_herd"],
  otter: ["ext_webbed_feet", "ext_prominent_whiskers", "soft_kids_icon", "soft_ocean_star", "soft_herd"],
  moose: ["ext_hooves", "ext_horns_or_antlers", "ext_long_neck", "soft_forests", "soft_herd"],
  bison: ["ext_hooves", "ext_big_outer_ears", "soft_savanna", "soft_herd"],
  parrot: ["ext_wings_or_beak", "ext_obvious_teeth", "soft_kids_icon", "soft_forests"],
  flamingo: ["ext_wings_or_beak", "ext_long_neck", "ext_webbed_feet", "soft_kids_icon", "soft_ocean_star", "soft_herd"],
  raccoon: ["ext_big_outer_ears", "ext_prominent_whiskers", "ext_prehensile_tail", "soft_forests", "soft_creepy"],
  squirrel: ["ext_big_outer_ears", "ext_burrows", "ext_prehensile_tail", "soft_forests", "soft_herd"],
  squid: ["ext_cold_blooded", "ext_many_arms_tentacles", "soft_ocean_star", "soft_creepy"],
};

export function buildAnimals() {
  const list = ANIMALS_RAW.map((raw) => {
    const a = { id: raw.id, name: raw.name };
    for (const k of BASE_KEYS) {
      a[k] = !!raw[k];
    }
    if (raw.id === "spider") a.insect = false;
    if (a.mammal || a.bird) a.warm_blooded = raw.warm_blooded !== false;
    else a.warm_blooded = !!raw.warm_blooded;
    a.vertebrate = raw.vertebrate !== false;

    for (const k of EXT_KEYS) a[k] = false;
    for (const k of SOFT_KEYS) a[k] = false;
    const extra = EXT_AND_SOFT_TRUE[raw.id];
    if (extra) {
      const allow = new Set([...EXT_KEYS, ...SOFT_KEYS]);
      for (const k of extra) {
        if (allow.has(k)) a[k] = true;
      }
    }

    for (const o of ANIMALS_RAW) {
      a[`sp_${o.id}`] = o.id === raw.id;
    }
    return a;
  });
  return list;
}
