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

    // NEW:
    uniform vec3 uCameraPos;   // orbit camera position in world space
    uniform vec2 uPlaneSize;   // water plane size in world units (width, height)

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
        float black = 0.072727;
        float white  = 0.177273;
        float color = 1.0;

        if (t <= black) {
            color = 0.0; // solid black
        }
        else if (t <= white) {
            // Linear interpolation: black → white
            float f = (t - black) / (white - black);
            color = mix(0.0, 1.0, f);
        }
        else {
            color = 1.0; // solid white again
        }

        return color;
    }

    float colorRamp2(float t){
        // Key stops
        float black = 0.131818;
        float white  = 0.595455;
        float color = 1.0;

        if (t <= black) {
            color = 0.0; // solid black
        }
        else if (t <= white) {
            // Linear interpolation: black → white
            float f = (t - black) / (white - black);
            color = mix(0.0, 1.0, f);
        }
        else {
            color = 1.0; // solid white again
        }

        return color;
    }

    float colorRamp3(float t){
        // Key stops
        float black1 = 0.545;
        float white  = 0.777;
        float black2  = 0.931;
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
            color = mix(0.0, 1.0, f);
        }
        else {
            color = 0.0; // solid white again
        }

        return color;
    }

    vec3 linearLight(vec3 a, vec3 b, float factor) {
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
        float h = 0.5 + 0.5*(b - a)/k;
        if(h > 1.){
            h = 0.999;
        }
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
        float k = mix(0.0, 0.6, smoothness);

        // Classic F1 when smoothness == 0, otherwise smooth min of F1/F2
        return (k <= 0.0) ? d1 : smin(d1, d2, k);
    }

    vec3 overlay(vec3 A, vec3 B) {

        vec3 result;
        for (int i = 0; i < 3; i++) {
            float a = A[i];
            float b = B[i];

            result[i] = (a < 0.5)
                ? (2.0 * a * b)
                : (1.0 - 2.0 * (1.0 - a) * (1.0 - b));
        }

        return result;
    }


    void main(){
        // World-space position of the current water-surface point.
        // Assuming the pool is centered at (0,0,0) on Y=0.
        vec3 worldPos = vec3(
            (vUv.x - 0.5) * uPlaneSize.x,
            0.0,
            (vUv.y - 0.5) * uPlaneSize.y
        );

        // Blender Geometry → Incoming:
        // direction from surface point *towards* camera.
        vec3 incoming = normalize(uCameraPos - worldPos);
        //Riverbed Depth
        float bedDepth = 1.;
        vec3 viewDir = -incoming;
        float denom = max(viewDir.y, 0.1);
        vec2 parallaxOffset = (viewDir.xz / denom) * bedDepth;
        vec3 riverbed_depth = vec3(parallaxOffset.x, 0.0, parallaxOffset.y);


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
        float worleyOutput2 = voronoiSmoothF1(linear_2, vec3(.5), 0.56, 1.0);
        float subtract = worleyOutput1 - worleyOutput2;

        //Add
        float add_result = subtract + 0.717 * colorRamp3(FMB_noise.r) * color_input.r;



        // Caustics Distortion
        float caustics_distortion_timeFactor = mod(t, 300.0) / 180.0;
        vec3 caustics_distortion_mapping = vec3(caustics_distortion_timeFactor, 0., 0.) + formatted_UV;
        vec3 caustics_distortion_noise = fbm(caustics_distortion_mapping, 1., 2.59, 1.);

        // Caustics Movement
        float caustics_movement_timeFactor1 = mod(t, 300.0) / 400.0;
        float caustics_movement_timeFactor2 = mod(t, 300.0) / 500.0;
        vec3 caustics_movement_vec = vec3(caustics_movement_timeFactor1, 0., caustics_movement_timeFactor2);
        vec3 caustics_movement_mapping = caustics_movement_vec + 0.026 * linearLight(linear_2, (linear + formatted_UV), 0.525) + riverbed_depth * 0.1;

        // Caustics Distortion Amount
        vec3 linear_3 = linearLight(caustics_distortion_noise, caustics_movement_mapping, 0.053);

        // Caustics Shape
        float caustics_shape_worleyOutput1 = voronoiSmoothF1(linear_3, vec3(6.), 0., 1.0);
        float caustics_shape_worleyOutput2 = voronoiSmoothF1(linear_3, vec3(6.), 0.619, 1.0);
        float caustics_shape_subtract = caustics_shape_worleyOutput1 - caustics_shape_worleyOutput2;
        float caustics_shape_color_ramp = colorRamp2(caustics_shape_subtract);
        vec3 blue2 = vec3(0.24824, 0.8, 0.8);
        vec3 caustics_shape_output = mix(vec3(0.), blue2, caustics_shape_subtract);




        // --- EMISSION BASED ON MASK / RAMP ---
        vec3 blue = vec3(0.454, 0.893, 1.0);

        float surface_tone = pow(colorRamp(add_result) * 9.07, 2.6);

        vec3 emissionColor = mix(caustics_shape_output, blue, surface_tone);

        float emissionStrength = pow(subtract * 10.93, 13.37) + 1.5;

        gl_FragColor = vec4(emissionColor, 1.0);
    }
`;

// Separable blur shaders
export const blurVert = /* glsl */`
// blurVert.glsl
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);  // fullscreen quad
}`