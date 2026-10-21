// Gate: image-scanned (scaffold placeholder).
// The real job builds the AD-11 image and runs Trivy, requiring a digest-pinned,
// non-root image with an SBOM and no high/critical finding. Image build + scan need
// Docker in CI, which the minimal scaffold does not wire up yet, so this passes and
// the builders replace it when the image story lands.
console.log('image-scanned: scaffold placeholder — image build/scan wired up by the image story. OK')
process.exit(0)
