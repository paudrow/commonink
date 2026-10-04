# Phone screenshots

Every screen at 393px wide (an iPhone 15), before and after the mobile redesign (#376), with a few at 768px and 1280px. `scripts/mobile-shots.ts` takes them, against an app signed in by DEV_LOGIN and filled by `scripts/preview-demo.ts`:

```bash
node --import tsx scripts/mobile-shots.ts http://localhost:8787 out/ --widths 393
```
