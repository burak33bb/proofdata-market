# ProofData Market

ProofData Market is a multilingual marketplace for publishing, discovering, licensing, and retrieving verifiable AI datasets on ShelbyNet.

**Live application:** [proofdatamarket.vercel.app](https://proofdatamarket.vercel.app)

## Why ProofData

AI teams need more than a download link. They need to understand where data came from, what they may do with it, whether the published bytes are authentic, and how software agents can access it.

ProofData combines:

- Shelby-backed dataset publishing and cryptographic integrity
- Petra wallet connection on ShelbyNet
- ShelbyUSD pricing and license payments
- AES-256-GCM encrypted file delivery
- seller controls for price, metadata, and delisting
- provenance, collection dates, geography, language, and usage rights
- format-aware previews for images, text, CSV/TSV, JSON, audio, video, PDF, and archives
- reviews, reports, disputes, favorites, notifications, and activity history
- an agent-ready API for programmatic discovery and access
- nine interface languages, including Turkish, English, Spanish, Portuguese, Chinese, Korean, Japanese, Russian, and Arabic

## Marketplace flow

1. A seller connects a Petra wallet configured for ShelbyNet.
2. The seller uploads a dataset, defines its price and license terms, and signs the publication.
3. ProofData encrypts the source file and publishes its Shelby commitment.
4. Buyers inspect a safe preview, provenance, rights, and integrity information.
5. A buyer pays the listed ShelbyUSD price and receives authorized access to the encrypted dataset.
6. The marketplace records verifiable activity without exposing the original file publicly.

## Local development

### Requirements

- Node.js 22.13 or newer
- npm
- Petra Wallet with ShelbyNet enabled

### Setup

```bash
git clone https://github.com/burak33bb/proofdata-market.git
cd proofdata-market
copy .env.example .env.local
npm install
npm run dev
```

Open the local URL shown by the development server.

### Environment variables

```dotenv
NEXT_PUBLIC_MARKETPLACE_TREASURY_ADDRESS=0xYOUR_SHELBYNET_ADDRESS
NEXT_PUBLIC_SHELBY_API_KEY=
BLOB_READ_WRITE_TOKEN=
```

- `NEXT_PUBLIC_MARKETPLACE_TREASURY_ADDRESS` receives marketplace license payments.
- `NEXT_PUBLIC_SHELBY_API_KEY` enables shared Shelby marketplace discovery. Create a client key in the [Shelby Developer Portal](https://developers.shelby.xyz/).
- `BLOB_READ_WRITE_TOKEN` is a server-only Vercel Blob credential used for marketplace records and encrypted payloads. Never expose or commit it.

## Useful commands

```bash
npm run dev
npm run build
npm test
npm run lint
```

## Shelby resources

- [Shelby documentation](https://docs.shelby.xyz/)
- [Shelby Developer Portal](https://developers.shelby.xyz/)
- [Shelby faucet guide](https://docs.shelby.xyz/apis/faucet/shelbyusd)
- [Shelby blob explorer](https://explorer.shelby.xyz/shelbynet)
- [Shelby quick-start](https://github.com/shelby/shelby-quickstart)
- [Shelby examples](https://github.com/shelby/examples)
- [Shelby feedback](https://github.com/shelby/feedback/issues/new/choose)

## Important status

ProofData currently runs on ShelbyNet and should be treated as testnet software. Test assets have no monetary value. Review the current Shelby documentation before using the project in a production or mainnet environment.

## Security

Do not commit `.env` files, wallet keys, seed phrases, API keys, or storage tokens. If you discover a vulnerability, avoid publishing secrets or exploit details in a public issue; contact the maintainers privately first.

## License

Released under the [MIT License](LICENSE).
