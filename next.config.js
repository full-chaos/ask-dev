/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // The Workbench is platform/test scoped until the Context Fabric beta gate
    // passes (CHAOS-3738). It is deliberately not indexed and not linked from
    // the Ask Dev window or /dev.
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "X-Robots-Tag", value: "noindex, nofollow" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy", value: "no-referrer" },
                ],
            },
        ];
    },
};

module.exports = nextConfig;
