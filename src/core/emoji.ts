// Emoji shortcodes, GitHub's names (`:tada:`): the ones people use most, not the whole set. A
// shortcode that isn't here stays as it's written. No Node imports: the editor uses this too.

const LIST = `
+1 👍|thumbsup 👍|-1 👎|thumbsdown 👎|ok_hand 👌|clap 👏|wave 👋|raised_hands 🙌|pray 🙏|muscle 💪|point_up 👆|point_down 👇|point_left 👈|point_right 👉|v ✌️|crossed_fingers 🤞|handshake 🤝|writing_hand ✍️|
smile 😄|smiley 😃|grinning 😀|laughing 😆|joy 😂|rofl 🤣|wink 😉|blush 😊|innocent 😇|slightly_smiling_face 🙂|upside_down_face 🙃|heart_eyes 😍|star_struck 🤩|kissing_heart 😘|yum 😋|sunglasses 😎|nerd_face 🤓|thinking 🤔|neutral_face 😐|expressionless 😑|no_mouth 😶|roll_eyes 🙄|smirk 😏|grimacing 😬|relieved 😌|pensive 😔|sleepy 😪|sleeping 😴|mask 😷|face_with_head_bandage 🤕|nauseated_face 🤢|sneezing_face 🤧|hot_face 🥵|cold_face 🥶|dizzy_face 😵|exploding_head 🤯|cowboy_hat_face 🤠|partying_face 🥳|confused 😕|worried 😟|frowning_face ☹️|open_mouth 😮|astonished 😲|flushed 😳|pleading_face 🥺|cry 😢|sob 😭|scream 😱|confounded 😖|disappointed 😞|sweat 😓|weary 😩|tired_face 😫|yawning_face 🥱|triumph 😤|rage 😡|angry 😠|skull 💀|poop 💩|clown_face 🤡|ghost 👻|alien 👽|robot 🤖|see_no_evil 🙈|hear_no_evil 🙉|speak_no_evil 🙊|shushing_face 🤫|zipper_mouth_face 🤐|saluting_face 🫡|melting_face 🫠|
heart ❤️|orange_heart 🧡|yellow_heart 💛|green_heart 💚|blue_heart 💙|purple_heart 💜|black_heart 🖤|white_heart 🤍|broken_heart 💔|sparkling_heart 💖|two_hearts 💕|heartpulse 💗|100 💯|boom 💥|collision 💥|dizzy 💫|sweat_drops 💦|zzz 💤|speech_balloon 💬|thought_balloon 💭|
eyes 👀|eye 👁️|brain 🧠|baby 👶|man 👨|woman 👩|person_raising_hand 🙋|person_shrugging 🤷|shrug 🤷|facepalm 🤦|dancer 💃|runner 🏃|walking 🚶|
tada 🎉|confetti_ball 🎊|balloon 🎈|gift 🎁|birthday 🎂|trophy 🏆|medal_sports 🏅|1st_place_medal 🥇|2nd_place_medal 🥈|3rd_place_medal 🥉|dart 🎯|game_die 🎲|jigsaw 🧩|art 🎨|performing_arts 🎭|musical_note 🎵|notes 🎶|microphone 🎤|headphones 🎧|movie_camera 🎥|clapper 🎬|video_game 🎮|soccer ⚽|basketball 🏀|
sparkles ✨|star ⭐|star2 🌟|stars 🌠|fire 🔥|zap ⚡|high_voltage ⚡|sunny ☀️|sun_with_face 🌞|cloud ☁️|partly_sunny ⛅|umbrella ☔|snowflake ❄️|snowman ⛄|rainbow 🌈|ocean 🌊|droplet 💧|crescent_moon 🌙|earth_americas 🌎|earth_africa 🌍|globe_with_meridians 🌐|seedling 🌱|evergreen_tree 🌲|deciduous_tree 🌳|palm_tree 🌴|cactus 🌵|herb 🌿|four_leaf_clover 🍀|maple_leaf 🍁|fallen_leaf 🍂|sunflower 🌻|rose 🌹|tulip 🌷|cherry_blossom 🌸|bouquet 💐|mushroom 🍄|
dog 🐶|cat 🐱|mouse 🐭|rabbit 🐰|fox_face 🦊|bear 🐻|panda_face 🐼|koala 🐨|tiger 🐯|lion 🦁|cow 🐮|pig 🐷|frog 🐸|monkey 🐒|chicken 🐔|penguin 🐧|bird 🐦|owl 🦉|eagle 🦅|duck 🦆|unicorn 🦄|bee 🐝|honeybee 🐝|bug 🐛|butterfly 🦋|snail 🐌|turtle 🐢|snake 🐍|octopus 🐙|whale 🐳|dolphin 🐬|fish 🐟|crab 🦀|t-rex 🦖|sauropod 🦕|dragon 🐉|
apple 🍎|green_apple 🍏|banana 🍌|grapes 🍇|watermelon 🍉|strawberry 🍓|peach 🍑|cherries 🍒|lemon 🍋|avocado 🥑|tomato 🍅|carrot 🥕|corn 🌽|hot_pepper 🌶️|bread 🍞|cheese 🧀|egg 🥚|bacon 🥓|hamburger 🍔|fries 🍟|pizza 🍕|hotdog 🌭|taco 🌮|burrito 🌯|sushi 🍣|ramen 🍜|spaghetti 🍝|cookie 🍪|cake 🍰|doughnut 🍩|ice_cream 🍨|chocolate_bar 🍫|popcorn 🍿|coffee ☕|tea 🍵|beer 🍺|beers 🍻|wine_glass 🍷|cocktail 🍸|champagne 🍾|
car 🚗|taxi 🚕|bus 🚌|truck 🚚|bike 🚲|train 🚆|airplane ✈️|rocket 🚀|ship 🚢|anchor ⚓|construction 🚧|vertical_traffic_light 🚦|house 🏠|office 🏢|hospital 🏥|school 🏫|bank 🏦|tent ⛺|world_map 🗺️|compass 🧭|mountain ⛰️|beach_umbrella 🏖️|
watch ⌚|iphone 📱|computer 💻|keyboard ⌨️|desktop_computer 🖥️|printer 🖨️|computer_mouse 🖱️|floppy_disk 💾|cd 💿|camera 📷|tv 📺|radio 📻|battery 🔋|electric_plug 🔌|bulb 💡|flashlight 🔦|candle 🕯️|
money_with_wings 💸|dollar 💵|moneybag 💰|credit_card 💳|gem 💎|scales ⚖️|wrench 🔧|hammer 🔨|hammer_and_wrench 🛠️|gear ⚙️|nut_and_bolt 🔩|link 🔗|chains ⛓️|toolbox 🧰|magnet 🧲|test_tube 🧪|microscope 🔬|telescope 🔭|satellite 📡|
lock 🔒|unlock 🔓|key 🔑|old_key 🗝️|shield 🛡️|door 🚪|bell 🔔|no_bell 🔕|mag 🔍|mag_right 🔎|
memo 📝|pencil 📝|pencil2 ✏️|pen 🖊️|paintbrush 🖌️|crayon 🖍️|book 📖|books 📚|notebook 📓|ledger 📒|closed_book 📕|green_book 📗|blue_book 📘|orange_book 📙|bookmark 🔖|label 🏷️|page_facing_up 📄|page_with_curl 📃|bookmark_tabs 📑|clipboard 📋|calendar 📆|date 📅|card_index 🗂️|file_folder 📁|open_file_folder 📂|chart_with_upwards_trend 📈|chart_with_downwards_trend 📉|bar_chart 📊|pushpin 📌|round_pushpin 📍|paperclip 📎|straight_ruler 📏|triangular_ruler 📐|scissors ✂️|wastebasket 🗑️|package 📦|mailbox 📫|email 📧|envelope ✉️|inbox_tray 📥|outbox_tray 📤|newspaper 📰|scroll 📜|
hourglass ⌛|hourglass_flowing_sand ⏳|alarm_clock ⏰|stopwatch ⏱️|timer_clock ⏲️|clock1 🕐|
white_check_mark ✅|heavy_check_mark ✔️|ballot_box_with_check ☑️|x ❌|negative_squared_cross_mark ❎|heavy_multiplication_x ✖️|heavy_plus_sign ➕|heavy_minus_sign ➖|question ❓|grey_question ❔|exclamation ❗|grey_exclamation ❕|bangbang ‼️|warning ⚠️|no_entry ⛔|no_entry_sign 🚫|stop_sign 🛑|children_crossing 🚸|recycle ♻️|infinity ♾️|information_source ℹ️|
arrow_up ⬆️|arrow_down ⬇️|arrow_left ⬅️|arrow_right ➡️|arrow_upper_right ↗️|arrow_lower_right ↘️|arrows_counterclockwise 🔄|repeat 🔁|leftwards_arrow_with_hook ↩️|arrow_right_hook ↪️|fast_forward ⏩|rewind ⏪|arrow_forward ▶️|pause_button ⏸️|stop_button ⏹️|record_button ⏺️|
red_circle 🔴|orange_circle 🟠|yellow_circle 🟡|green_circle 🟢|large_blue_circle 🔵|blue_circle 🔵|purple_circle 🟣|black_circle ⚫|white_circle ⚪|red_square 🟥|green_square 🟩|blue_square 🟦|small_red_triangle 🔺|small_red_triangle_down 🔻|large_orange_diamond 🔶|large_blue_diamond 🔷|
new 🆕|free 🆓|up 🆙|cool 🆒|ok 🆗|sos 🆘|top 🔝|soon 🔜|end 🔚|back 🔙|on 🔛|abc 🔤|1234 🔢|hash #️⃣|
flag_white 🏳️|checkered_flag 🏁|triangular_flag_on_post 🚩|rainbow_flag 🏳️‍🌈|pirate_flag 🏴‍☠️|
bug 🐛|rotating_light 🚨|construction_worker 👷|ambulance 🚑|lipstick 💄|lock_with_ink_pen 🔏|pencil2 ✏️|truck 🚚|twisted_rightwards_arrows 🔀|rewind ⏪|heavy_dollar_sign 💲|busts_in_silhouette 👥|bust_in_silhouette 👤|speaking_head 🗣️|thread 🧵|goal_net 🥅|
`;

/** Shortcode (without colons) → emoji. */
export const EMOJI: ReadonlyMap<string, string> = new Map(
  LIST.split(/\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const at = s.indexOf(" ");
      return [s.slice(0, at), s.slice(at + 1)] as [string, string];
    }),
);

/** The emoji for `:name:`'s name, or null if it isn't one we know. */
export const emojiFor = (name: string) => EMOJI.get(name) ?? null;

/** `:name:` in text: a shortcode where a word can start (not in `10:30` or a URL's path). */
export const SHORTCODE = /(?<![\w:/])(:([a-z0-9_+-]+):)(?![\w/])/g;

/** Text with every known shortcode as its emoji; unknown ones stay as written. */
export const withEmoji = (text: string) => text.replace(SHORTCODE, (m, _all, name: string) => emojiFor(name) ?? m);
