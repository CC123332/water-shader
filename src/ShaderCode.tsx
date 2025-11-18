import * as THREE from 'three'

// --- fBM pass (reads blurred mask -> writes fBM-masked float into a new target) ---

export const fbmFrag = /* glsl */`
    precision highp float;

    varying vec2 vUv;

    uniform sampler2D uTex;   // blurred color (blue↔white), use full RGB now
    uniform float uScale;     // domain scale for fBM (applied to color)
    uniform int   uOctaves;
    uniform float uGain;
    uniform float uLacunarity;
    uniform float uNormFactor;
    uniform float t;           // time variable [0,300]

    // 3D hash → scalar in [0,1)
    float random3D(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }

    // 3D value noise with smooth trilinear interpolation
    float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);

        // eight lattice corners
        float n000 = random3D(i + vec3(0.0, 0.0, 0.0));
        float n100 = random3D(i + vec3(1.0, 0.0, 0.0));
        float n010 = random3D(i + vec3(0.0, 1.0, 0.0));
        float n110 = random3D(i + vec3(1.0, 1.0, 0.0));
        float n001 = random3D(i + vec3(0.0, 0.0, 1.0));
        float n101 = random3D(i + vec3(1.0, 0.0, 1.0));
        float n011 = random3D(i + vec3(0.0, 1.0, 1.0));
        float n111 = random3D(i + vec3(1.0, 1.0, 1.0));

        // smoothstep-like curve (quintic also works: f*f*f*(f*(f*6-15)+10))
        vec3 u = f * f * (3.0 - 2.0 * f);

        float nx00 = mix(n000, n100, u.x);
        float nx10 = mix(n010, n110, u.x);
        float nx01 = mix(n001, n101, u.x);
        float nx11 = mix(n011, n111, u.x);

        float nxy0 = mix(nx00, nx10, u.y);
        float nxy1 = mix(nx01, nx11, u.y);

        return mix(nxy0, nxy1, u.z);
    }

    vec3 fbm(vec3 p, float scale, float detail, float roughness) {
        // Fractal Brownian Motion: vec3 → vec3
        const int MAX_OCTAVES = 16;

        float amplitude = 0.5;
        float frequency = 1.0;
        vec3  sum = vec3(0.0);

        // decorrelation offsets for RGB channels
        const vec3 oR = vec3(17.0,  0.0, 13.0);
        const vec3 oG = vec3( 0.0, 11.0,  7.0);
        const vec3 oB = vec3( 5.0, 29.0,  0.0);

        // Blender "Scale" ≈ multiply the position
        p *= scale;

        // Blender "Detail" ≈ number of octaves
        int octaveCount = int(floor(detail));
        octaveCount = clamp(octaveCount, 1, MAX_OCTAVES);

        for (int i = 0; i < MAX_OCTAVES; i++) {
            if (i >= octaveCount) break;

            vec3 pf = p * frequency;
            sum += amplitude * vec3(
                noise(pf + oR),
                noise(pf + oG),
                noise(pf + oB)
            );

            // Blender "Roughness" ≈ amplitude multiplier per octave
            amplitude *= roughness;

            // Lacunarity (frequency multiplier) - Blender default is 2.0
            frequency *= 2.0;
        }

        return sum;
    }

    float colorRamp(float t){
        // Key stops
        float black1 = 0.545;
        float white  = 0.777;
        float black2 = 0.932;
        float color = 0.0;

        if (t <= black1) {
            color = 0.0; // solid black
        }
        else if (t <= white) {
            // Linear interpolation: black → white
            float f = (t - black1) / (white - black1);
            color = mix(0.0, 1.0, f);
        }
        else if (t <= black2) {
            // Linear interpolation: white → black
            float f = (t - white) / (black2 - white);
            color = mix(1.0, 0.0, f);
        }
        else {
            color = 0.0; // solid black again
        }

        return color;
    }

    vec3 linearLight(vec3 a, vec3 b, float factor) {
        factor = clamp(factor, 0.0, 1.0);
        vec3 blend = b + 2.0 * a - 1.0;
        return mix(b, blend, factor);
    }

    // Simple 3D hash returning vec3 in [0,1)
    vec3 random3(vec3 p) {
        // Three different dot bases give 3 decorrelated channels
        const vec3 dotA = vec3(127.1, 311.7, 74.7);
        const vec3 dotB = vec3(269.5, 183.3, 246.1);
        const vec3 dotC = vec3(113.5, 271.9, 124.6);

        float x = sin(dot(p, dotA)) * 43758.5453;
        float y = sin(dot(p, dotB)) * 43758.5453;
        float z = sin(dot(p, dotC)) * 43758.5453;
        return fract(vec3(x, y, z));
    }

    // Inigo Quilez-style smooth min for distances
    float smin(float a, float b, float k) {
        // k is the smoothing radius (in distance units)
        float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
        return mix(b, a, h) - k*h*(1.0 - h);
    }

    float voronoiSmoothF1(vec3 uvw, vec3 cells, float smoothness, float jitter) {
        vec3 p = uvw * cells;

        vec3 i = floor(p);   // integer cell coords
        vec3 f = fract(p);   // local coords inside the cell

        // Track nearest two distances (F1 and F2)
        float d1 = 1e9;
        float d2 = 1e9;

        // Search 3x3x3 neighborhood
        for (int z = -1; z <= 1; z++) {
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    vec3 n = vec3(float(x), float(y), float(z));
                    vec3 r = random3(i + n);

                    // Blender-style jitter: mix center vs random feature location
                    vec3 feature = n + mix(vec3(0.5), r, jitter);

                    // Euclidean distance (Blender default)
                    float d = length(feature - f);

                    // keep the two smallest
                    if (d < d1) { d2 = d1; d1 = d; }
                    else if (d < d2) { d2 = d; }
                }
            }
        }

        // Map 0..1 smoothness to a smoothing radius in cell-space
        float k = mix(0.0, 0.6, clamp(smoothness, 0.0, 1.0));

        // Classic F1 when smoothness == 0, otherwise smooth min of F1/F2
        return (k <= 0.0) ? d1 : smin(d1, d2, k);
    }


    void main(){
        //Format UV
        vec3 formatted_UV = vec3(vUv.x * 25., vUv.y * 25., 0.);

        //Color Input
        vec3 color_input = vec3(texture2D(uTex, vUv).r);

        if(color_input.r > 0.){
            gl_FragColor = vec4(0., 0., 0., 1.0);
            return;
        }

        //FMB noise
        // Time factor cycles from 0 → 300, normalized by /60.0
        float timeFactor = mod(t, 300.0) / 60.0;
        vec3 FMB_noise = fbm(color_input + timeFactor, 4.37, 2.0, 0.45);

        //Linear Light
        vec3 linear = linearLight(FMB_noise, formatted_UV, color_input.r);

        //Surface Distribution Amount
        //Water Surface Distribution
        vec3 FMB_noise_2 = fbm(formatted_UV + vec3(timeFactor, 0., 0.), 1.16, 3.59, 0.597917);
        vec3 linear_2 = linearLight(FMB_noise_2, (linear + formatted_UV), 0.65);


        //Voronoi
        float worleyOutput1 = voronoiSmoothF1(linear_2, vec3(.5), 0., 1.0);
        float worleyOutput2 = voronoiSmoothF1(linear_2, vec3(.5), 0.55, 1.0);
        float subtract = worleyOutput1 - worleyOutput2;

        //Add
        float Add = subtract + 0.717 * clamp(colorRamp(FMB_noise.r) * color_input.r, 0.0, 1.0);

        gl_FragColor = vec4(subtract, Add, 0., 1.0);
    }
`;

// Separable blur shaders
export const blurVert = /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`