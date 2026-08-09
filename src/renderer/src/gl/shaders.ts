/**
 * Шейдери лінзи "лазерні очі".
 *
 * Пайплайн: scene (відео + грейд) -> beams (адитивно) -> bright pass ->
 * два ланцюги blur -> composite з тонмапом.
 */

/** Спільний вертексний шейдер: повноекранний трикутник-квад. */
export const QUAD_VS = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

/**
 * Кадр з камери, підміна фону й кольорокорекція.
 *
 * Маска приходить з моделі сегментації у власній роздільності й у власній
 * орієнтації — вона рахується з незеркаленого кадру, тому дзеркалення
 * застосовується до обох вибірок однаково.
 */
export const SCENE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVideo;
uniform sampler2D uBlurred;   // той самий кадр, розмитий — фон для режиму «розмити»
uniform sampler2D uMask;      // 1 = людина, 0 = фон
uniform float uMirror;        // 1.0 = дзеркалити по X (селфі)
uniform float uExposure;      // множник яскравості сцени
uniform float uContrast;
uniform float uSaturation;
uniform float uBgMode;        // 0 — без заміни, 1 — розмити, 2 — колір
uniform vec3  uBgColor;
uniform float uMaskSoftness;  // згладжування краю маски в частках кадру

uniform float uAspect;
// Спотворення: до чотирьох осередків, кожен — центр, радіус і сила.
// Додатна сила надуває, від'ємна втягує.
uniform int   uWarpCount;
uniform vec2  uWarpCenter[4];
uniform float uWarpRadius[4];
uniform float uWarpStrength[4];

/**
 * Локальне спотворення навколо точки — класична лінза.
 *
 * Зсуваємо не колір, а відстань точки вибірки від центру: нова відстань це
 * r * (dist/r)^k. На межі осередку вираз дає рівно r, тому перехід до звичайної
 * картинки безшовний сам собою, без окремого згасання.
 *
 * k > 1 стискає вибірку до центру — на екрані це збільшення. k < 1 навпаки.
 */
vec2 warp(vec2 uv) {
  vec2 p = vec2(uv.x * uAspect, uv.y);

  for (int i = 0; i < 4; i++) {
    if (i >= uWarpCount) break;

    vec2 center = vec2(uWarpCenter[i].x * uAspect, uWarpCenter[i].y);
    vec2 d = p - center;
    float dist = length(d);
    float r = uWarpRadius[i];
    if (dist >= r || dist < 1e-5) continue;

    float k = 1.0 + uWarpStrength[i] * 2.0;
    float scaled = r * pow(dist / r, max(k, 0.05));
    p = center + d * (scaled / dist);
  }

  return vec2(p.x / uAspect, p.y);
}

void main() {
  vec2 uv = vUv;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  if (uWarpCount > 0) uv = warp(uv);

  vec3 c = texture(uVideo, uv).rgb;

  if (uBgMode > 0.5) {
    // Кадр камери лягає в текстуру перевернутим по вертикалі, а маска приходить
    // масивом як є — тому для неї переворот робимо тут, явно.
    vec2 muv = vec2(uv.x, 1.0 - uv.y);

    // Маску злегка розмиваємо вручну: модель дає різкий контур по пікселях,
    // і без цього людина виглядає вирізаною ножицями.
    float m = 0.0;
    m += texture(uMask, muv).r * 0.4;
    m += texture(uMask, muv + vec2(uMaskSoftness, 0.0)).r * 0.15;
    m += texture(uMask, muv - vec2(uMaskSoftness, 0.0)).r * 0.15;
    m += texture(uMask, muv + vec2(0.0, uMaskSoftness)).r * 0.15;
    m += texture(uMask, muv - vec2(0.0, uMaskSoftness)).r * 0.15;
    m = smoothstep(0.35, 0.65, m);

    vec3 bg = uBgMode > 1.5 ? uBgColor : texture(uBlurred, uv).rgb;
    c = mix(bg, c, m);
  }

  c *= uExposure;
  c = (c - 0.5) * uContrast + 0.5;

  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);

  fragColor = vec4(max(c, 0.0), 1.0);
}`

/** Кадр з камери без обробки — потрібен, щоб зробити з нього розмитий фон. */
export const VIDEO_COPY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVideo;
void main() {
  fragColor = vec4(texture(uVideo, vUv).rgb, 1.0);
}`

/**
 * Промені з очей. Малюється адитивно поверх сцени.
 * Усі відстані рахуються в аспект-скоригованому просторі, щоб коло було колом.
 */
export const BEAM_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform vec2  uEyeL;        // центр лівої зіниці в uv екрана
uniform vec2  uEyeR;
uniform vec2  uDir;         // напрямок погляду в екранних uv (вже нормалізований)
uniform float uAspect;      // ширина / висота
uniform float uActive;      // 0..1 — плавна поява, коли обличчя знайдено

uniform float uCoreSize;    // радіус яскравого ядра в зіниці
uniform float uStreakLen;   // довжина горизонтального штриха
uniform float uStreakWidth;
uniform float uBeamLen;     // довжина направленого променя
uniform float uBeamWidth;
uniform float uBeamSpread;  // як промінь розширюється з відстанню
uniform float uStreakGain;
uniform float uBeamGain;
uniform float uIntensity;
uniform float uSharpness;   // 2 = гаусів розмитий, 6+ = різкий лазер
uniform vec3  uColor;

/**
 * Поперечний профіль променя.
 * Показник 2.0 дає звичайний гаус — м'яке розмите пасмо.
 * Більші значення роблять пласку вершину з різким спадом, тобто чіткий лазер.
 */
float profile(float d, float w, float sharp) {
  return exp(-pow(abs(d) / max(w, 1e-5), sharp));
}

/** Гаряче тонке ядро всередині ширшого пасма — саме воно читається як лазер. */
float hotProfile(float d, float w, float sharp) {
  return profile(d, w, sharp) + 0.9 * profile(d, w * 0.3, sharp);
}

/** Яскраве ядро в самій зіниці. */
float core(vec2 p, float size) {
  return profile(length(p), size, uSharpness);
}

/** Горизонтальний анаморфний штрих — симетричний, як відблиск об'єктива. */
float streak(vec2 p, float len, float width) {
  float across = hotProfile(p.y, width, uSharpness);
  float along = exp(-abs(p.x) / len);
  return across * along;
}

/** Направлений конус уздовж погляду. */
float beam(vec2 p, vec2 d, float len, float width, float spread) {
  float t = dot(p, d);
  float perp = length(p - t * d);

  // За очима промінь гасне різко, попереду — плавно розширюється.
  float w = width + max(t, 0.0) * spread;
  float radial = hotProfile(perp, w, uSharpness);
  float along = exp(-max(t, 0.0) / len) * smoothstep(-0.015, 0.02, t);
  return radial * along;
}

float eyeContribution(vec2 uv, vec2 eye) {
  vec2 p = (uv - eye) * vec2(uAspect, 1.0);
  float v = core(p, uCoreSize) * 2.0;
  v += streak(p, uStreakLen, uStreakWidth) * uStreakGain;
  v += beam(p, uDir, uBeamLen, uBeamWidth, uBeamSpread) * uBeamGain;
  return v;
}

void main() {
  float v = eyeContribution(vUv, uEyeL) + eyeContribution(vUv, uEyeR);
  v *= uIntensity * uActive;

  // Перегрів до чисто білого в центрі: гаряче ядро втрачає відтінок.
  vec3 c = uColor * v;
  c = mix(c, vec3(v), clamp(v - 1.0, 0.0, 1.0));

  fragColor = vec4(c, 1.0);
}`

/**
 * Атмосфера: низовий дим і блискавки згори.
 *
 * Виводить колір з преммультиплікованою альфою і малюється з
 * blendFunc(ONE, ONE_MINUS_SRC_ALPHA). Завдяки цьому дим змішується як
 * напівпрозорий шар, а блискавка (alpha = 0) лягає чисто адитивно — усе за один прохід.
 */
export const FX_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float uTime;
uniform float uAspect;

uniform float uSmokeAmount;
uniform float uSmokeHeight;
uniform float uSmokeSpeed;
uniform float uSmokeScale;
uniform vec3  uSmokeColor;

uniform float uBoltCount;
uniform float uBoltRate;
uniform float uBoltLen;
uniform float uBoltWidth;
uniform float uBoltGlow;
uniform float uFlash;
uniform vec3  uBoltColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

/** Тонкий шар диму по низу кадру. */
float smokeAlpha(vec2 uv) {
  if (uSmokeAmount <= 0.001) return 0.0;

  float t = uTime * uSmokeSpeed;
  vec2 p = vec2(uv.x * uAspect, uv.y) * uSmokeScale;

  // Доменний варп — саме він робить клуби, а не рівні смуги.
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.15)), fbm(p + vec2(3.7, 1.2) - vec2(t * 0.1, 0.0)));
  float n = fbm(p + q * 1.2 + vec2(t * 0.25, -t * 0.05));
  n = smoothstep(0.32, 0.85, n);

  // Квадрат маски притискає дим до самого низу і прибирає лінію обрізу зверху.
  float h = smoothstep(uSmokeHeight, 0.0, uv.y);
  h *= h;

  return clamp(n * h * uSmokeAmount, 0.0, 1.0);
}

/** Ламана траєкторія розряду: три октави зміщення, що росте донизу. */
float boltPath(float seed, float y) {
  float x = hash(vec2(seed, 3.1));
  x += (noise(vec2(seed * 19.0, y * 5.0)) - 0.5) * 0.35 * y;
  x += (noise(vec2(seed * 41.0, y * 14.0)) - 0.5) * 0.12 * y;
  x += (noise(vec2(seed * 73.0, y * 37.0)) - 0.5) * 0.04 * y;
  return x;
}

/** Обвідна спалаху: різкий фронт, швидкий спад і слабший повторний удар. */
float strike(float seed) {
  float ts = uTime * uBoltRate + seed * 6.37;
  float cyc = floor(ts);
  float loc = fract(ts);

  // Б'є не в кожному циклі, інакше виходить стробоскоп замість грози.
  float fires = step(0.55, hash(vec2(cyc * 1.7, seed * 3.3)));
  float env = exp(-loc * 16.0) + 0.55 * exp(-abs(loc - 0.09) * 40.0);
  return fires * env;
}

void main() {
  float y = 1.0 - vUv.y;   // 0 — верхня межа кадру
  float lightning = 0.0;
  float flash = 0.0;

  for (int i = 0; i < 4; i++) {
    if (float(i) >= uBoltCount) break;

    float seed = float(i) + 1.0;
    float env = strike(seed);
    if (env < 0.002) continue;

    float d = abs(vUv.x - boltPath(seed, y)) * uAspect;
    // 1/d замість гауса — дає тонке різке ядро з природним ореолом.
    float coreLine = pow(uBoltWidth / (d + uBoltWidth), 3.0);
    float halo = uBoltWidth * 6.0 / (d + uBoltWidth * 6.0);
    float fade = smoothstep(uBoltLen, uBoltLen * 0.2, y);

    lightning += (coreLine + halo * uBoltGlow * 0.25) * fade * env;
    flash += env;
  }

  float a = smokeAlpha(vUv);

  vec3 rgb = uSmokeColor * a;                       // дим — з альфою
  rgb += uBoltColor * lightning;                    // розряд — адитивно
  rgb += uBoltColor * flash * uFlash * vUv.y;       // підсвітка кадру згори

  fragColor = vec4(rgb, a);
}`

/** Відбір яскравих пікселів для bloom. */
export const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;

void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // М'який поріг, щоб не було рваного контуру на межі відсічення.
  float soft = smoothstep(uThreshold, uThreshold + uKnee, l);
  fragColor = vec4(c * soft, 1.0);
}`

/**
 * Накладка, посаджена на дві точки обличчя.
 *
 * Обчислення йдуть в «аспект-просторі», де x помножено на співвідношення сторін:
 * там коло лишається колом, тож поворот не перекошує картинку.
 */
export const OVERLAY_VS = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;

uniform vec2  uCenter;
uniform vec2  uHalfSize;
uniform float uAngle;
uniform float uAspect;

void main() {
  vUv = aPos * 0.5 + 0.5;

  vec2 local = aPos * uHalfSize;
  float s = sin(uAngle);
  float c = cos(uAngle);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);

  vec2 p = uCenter + rotated;
  gl_Position = vec4(vec2(p.x / uAspect, p.y) * 2.0 - 1.0, 0.0, 1.0);
}`

export const OVERLAY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform float uOpacity;

void main() {
  vec4 c = texture(uTex, vUv);
  fragColor = vec4(c.rgb, c.a * uOpacity);
}`

/** Просте копіювання текстури — готовий кадр на екран. */
export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
void main() {
  fragColor = vec4(texture(uTex, vUv).rgb, 1.0);
}`

/**
 * Пакує готовий кадр одразу у формат NV12 для віртуальної камери.
 *
 * Ціль має розмір (W/4) x (H*3/2): кожен RGBA-тексель тримає 4 послідовні байти
 * буфера, тож один рядок цілі = один рядок NV12. Завдяки цьому весь кадр
 * знімається одним readPixels і йде в OBS без жодної обробки на CPU.
 *
 * Рядок 0 цілі відповідає рядку 0 буфера, а readPixels віддає рядки знизу вгору —
 * тому нумерація тут ведеться від низу цілі, і зайвого перевороту не потрібно.
 */
export const NV12_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uSize;       // розмір кадру віртуальної камери
uniform vec2 uFitScale;   // вписування джерела іншої пропорції

// BT.601, обмежений діапазон — саме його чекає DirectShow від NV12.
float toY(vec3 c) { return (16.0 + dot(c, vec3(65.481, 128.553, 24.966))) / 255.0; }
float toU(vec3 c) { return (128.0 + dot(c, vec3(-37.797, -74.203, 112.0))) / 255.0; }
float toV(vec3 c) { return (128.0 + dot(c, vec3(112.0, -93.786, -18.214))) / 255.0; }

vec3 fetch(float x, float rowFromTop) {
  vec2 uv = vec2((x + 0.5) / uSize.x, 1.0 - (rowFromTop + 0.5) / uSize.y);
  uv = (uv - 0.5) * uFitScale + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture(uTex, uv).rgb;
}

void main() {
  float px = floor(gl_FragCoord.x);
  float row = floor(gl_FragCoord.y);
  float x0 = px * 4.0;

  if (row < uSize.y) {
    // Площина яскравості: чотири сусідні пікселі в один тексель.
    fragColor = vec4(
      toY(fetch(x0, row)),
      toY(fetch(x0 + 1.0, row)),
      toY(fetch(x0 + 2.0, row)),
      toY(fetch(x0 + 3.0, row))
    );
  } else {
    // Площина кольоровості: вдвічі менша по обох осях, U та V чергуються.
    float y0 = (row - uSize.y) * 2.0;
    vec3 a = 0.25 * (fetch(x0, y0) + fetch(x0 + 1.0, y0) +
                     fetch(x0, y0 + 1.0) + fetch(x0 + 1.0, y0 + 1.0));
    vec3 b = 0.25 * (fetch(x0 + 2.0, y0) + fetch(x0 + 3.0, y0) +
                     fetch(x0 + 2.0, y0 + 1.0) + fetch(x0 + 3.0, y0 + 1.0));
    fragColor = vec4(toU(a), toV(a), toU(b), toV(b));
  }
}`

/** Роздільне гаусове розмиття, 9 відліків з лінійною фільтрацією. */
export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uStep;   // (texel.x * radius, 0) або (0, texel.y * radius)

const float W0 = 0.2270270270;
const float W1 = 0.3162162162;
const float W2 = 0.0702702703;
const float O1 = 1.3846153846;
const float O2 = 3.2307692308;

void main() {
  vec3 c = texture(uTex, vUv).rgb * W0;
  c += texture(uTex, vUv + uStep * O1).rgb * W1;
  c += texture(uTex, vUv - uStep * O1).rgb * W1;
  c += texture(uTex, vUv + uStep * O2).rgb * W2;
  c += texture(uTex, vUv - uStep * O2).rgb * W2;
  fragColor = vec4(c, 1.0);
}`

/** Фінал: сцена + bloom, тонмап ACES, віньєтка. */
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloomNear;
uniform sampler2D uBloomFar;
uniform float uBloomStrength;
uniform float uVignette;

/**
 * Гасить лише перепал, лишаючи звичайний діапазон недоторканим.
 *
 * Тут раніше стояла повна крива ACES, і це була помилка: вона розрахована на
 * HDR-сцену, а кадр з камери вже готовий до показу. Вона піднімала середні тони
 * й обрізала білий на 0.8 — через що картинка виходила сірувата й вицвіла.
 * Тепер усе до порога проходить один в один, а вище — плавно стискається до одиниці.
 */
vec3 rolloff(vec3 x) {
  // Поріг майже на самій вершині: усе, що вміщається в діапазон показу, має
  // дійти незмінним. Стискається лише перепал від сяйва, що вилазить за одиницю.
  const float knee = 0.985;
  vec3 high = knee + (1.0 - knee) * (1.0 - exp(-(x - knee) / (1.0 - knee)));
  return clamp(mix(x, high, step(vec3(knee), x)), 0.0, 1.0);
}

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloomNear, vUv).rgb + texture(uBloomFar, vUv).rgb * 0.8;

  vec3 c = scene + bloom * uBloomStrength;
  c = rolloff(c);

  vec2 d = vUv - 0.5;
  float vig = 1.0 - uVignette * dot(d, d) * 2.0;
  c *= clamp(vig, 0.0, 1.0);

  fragColor = vec4(c, 1.0);
}`
