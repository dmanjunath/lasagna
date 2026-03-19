/**
 * Script to fetch and parse Shiller's historical S&P 500 data
 * Run: npx tsx packages/api/scripts/update-shiller-data.ts
 */
import * as XLSX from "xlsx";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SHILLER_URL = "http://www.econ.yale.edu/~shiller/data/ie_data.xls";
const OUTPUT_PATH = resolve(__dirname, "../data/shiller-historical.json");

interface YearlyData {
  year: number;
  realPrice: number;
  realDividend: number;
  realEarnings: number;
  cpi: number;
  realTotalReturn: number;
}

async function fetchShillerData(): Promise<YearlyData[]> {
  console.log("Fetching Shiller data from Yale...");
  const response = await fetch(SHILLER_URL);
  const buffer = await response.arrayBuffer();

  const workbook = XLSX.read(buffer, { type: "array" });

  // Use the "Data" sheet which contains the historical data
  const sheet = workbook.Sheets["Data"];
  if (!sheet) {
    throw new Error(`"Data" sheet not found. Available sheets: ${workbook.SheetNames.join(", ")}`);
  }

  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  // Find the start of data - look for row starting with a year-like number
  let startRow = 0;
  for (let i = 0; i < Math.min(50, rawData.length); i++) {
    const row = rawData[i];
    if (row && typeof row[0] === "number" && row[0] > 1800 && row[0] < 2100) {
      startRow = i;
      break;
    }
  }

  const yearlyData: Map<number, YearlyData> = new Map();

  for (let i = startRow; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !row[0]) continue;

    const dateVal = row[0];
    if (typeof dateVal !== "number") continue;

    const year = Math.floor(dateVal);
    if (year < 1930 || year > new Date().getFullYear()) continue;

    const price = parseFloat(String(row[1])) || 0;
    const dividend = parseFloat(String(row[2])) || 0;
    const earnings = parseFloat(String(row[3])) || 0;
    const cpi = parseFloat(String(row[4])) || 0;

    if (!yearlyData.has(year)) {
      yearlyData.set(year, {
        year,
        realPrice: price,
        realDividend: dividend,
        realEarnings: earnings,
        cpi,
        realTotalReturn: 0,
      });
    }
  }

  const years = Array.from(yearlyData.keys()).sort((a, b) => a - b);
  for (let i = 1; i < years.length; i++) {
    const prevYear = yearlyData.get(years[i - 1])!;
    const currYear = yearlyData.get(years[i])!;

    const priceReturn = (currYear.realPrice - prevYear.realPrice) / prevYear.realPrice;
    const dividendYield = currYear.realDividend / prevYear.realPrice;
    currYear.realTotalReturn = priceReturn + dividendYield;
  }

  return Array.from(yearlyData.values()).sort((a, b) => a.year - b.year);
}

async function main() {
  try {
    const data = await fetchShillerData();

    const output = {
      source: "Robert Shiller, Yale University",
      url: SHILLER_URL,
      updatedAt: new Date().toISOString(),
      startYear: data[0]?.year,
      endYear: data[data.length - 1]?.year,
      data,
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`Written ${data.length} years of data to ${OUTPUT_PATH}`);
    console.log(`Range: ${output.startYear} - ${output.endYear}`);
  } catch (error) {
    console.error("Failed to update Shiller data:", error);
    process.exit(1);
  }
}

main();
