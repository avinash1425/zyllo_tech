// RETIRED / UNUSED as of Aug 2026: the Tax Savings calculator was reverted
// back to India-only framing (Old vs New regime comparison using
// TAX_RATES_FY_2026_27 from src/data/arthaai-rates.js). Nothing in the app
// imports this file anymore. Left in place for reference only.
//
// Illustrative progressive tax bracket presets for the generic Tax
// Estimator. These are simplified, ROUNDED example structures meant to
// show how a progressive bracket system works — they are NOT an
// authoritative or current representation of any real country's actual
// tax code, and deliberately avoid claiming to be. Users should enter
// their own country/region's actual brackets for an accurate estimate;
// these presets exist only to give the calculator a sensible starting
// point instead of an empty form.

export const BRACKET_PRESETS = [
  {
    id: "custom",
    label: "Custom (enter your own brackets)",
    brackets: [
      { upTo: 20000, rate: 0 },
      { upTo: 50000, rate: 0.1 },
      { upTo: 100000, rate: 0.2 },
      { upTo: Infinity, rate: 0.3 },
    ],
  },
  {
    id: "simple-progressive",
    label: "Example: Simple 4-bracket progressive system",
    brackets: [
      { upTo: 15000, rate: 0 },
      { upTo: 45000, rate: 0.12 },
      { upTo: 120000, rate: 0.22 },
      { upTo: Infinity, rate: 0.32 },
    ],
  },
  {
    id: "flat-with-exemption",
    label: "Example: Flat rate with a tax-free threshold",
    brackets: [
      { upTo: 12000, rate: 0 },
      { upTo: Infinity, rate: 0.2 },
    ],
  },
];

export const DEFAULT_PRESET_ID = "simple-progressive";
