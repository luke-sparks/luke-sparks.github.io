class Noise {
    constructor(seed) {
        this.seed = this.hashSeed(seed || Math.random().toString());
        this._seedHash = this.seed * 999999999; // Pre-compute for hash()
    }

    hashSeed(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        // Ensure seed has strong impact by using multiple hash iterations
        h = h * 1013904223 + 1664525;
        h = h * 1664525 + 1013904223;
        return Math.abs(h) / 2147483648;
    }

    hash(x, y, z) {
        // Strong hash function that amplifies seed differences
        let h = this._seedHash + x * 374761393 + y * 668265263 + z * 1274126177;
        h = (h ^ (h >>> 13)) * 1274126177;
        h = (h ^ (h >>> 16)) * 1974126343;
        h = (h ^ (h >>> 7)) * 1374761393;
        return (h ^ (h >>> 14)) / 4294967296 + 0.5;
    }

    smoothstep(t) { return t * t * (3 - 2 * t); }

    noise3D(x, y, z) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        const fx = x - ix, fy = y - iy, fz = z - iz;
        const sx = this.smoothstep(fx), sy = this.smoothstep(fy), sz = this.smoothstep(fz);

        // Get hash values for cube corners
        const c000 = this.hash(ix, iy, iz);
        const c001 = this.hash(ix, iy, iz+1);
        const c010 = this.hash(ix, iy+1, iz);
        const c011 = this.hash(ix, iy+1, iz+1);
        const c100 = this.hash(ix+1, iy, iz);
        const c101 = this.hash(ix+1, iy, iz+1);
        const c110 = this.hash(ix+1, iy+1, iz);
        const c111 = this.hash(ix+1, iy+1, iz+1);

        // Trilinear interpolation
        const c00 = c000*(1-sx) + c100*sx;
        const c01 = c001*(1-sx) + c101*sx;
        const c10 = c010*(1-sx) + c110*sx;
        const c11 = c011*(1-sx) + c111*sx;

        const c0 = c00*(1-sy) + c10*sy;
        const c1 = c01*(1-sy) + c11*sy;

        return c0*(1-sz) + c1*sz;
    }

    fbm(x, y, z, octaves = 6) {
        let value = 0, amp = 1, freq = 1, maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            value += this.noise3D(x * freq, y * freq, z * freq) * amp;
            maxValue += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return value / maxValue;
    }
}

// For module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Noise;
}