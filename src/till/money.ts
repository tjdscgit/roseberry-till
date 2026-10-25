import type { Option } from "./types";

// All amounts are integer cents.
export const money = (c: number) => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toFixed(2);

// Short price for labels: "$5", "$4.50".
export const price = (c: number) => "$" + (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

export const optionPrice = (o: Option) => (o.unit === "kg" ? `${price(o.price)}/kg` : price(o.price));

export const kg = (grams: number) => `${(grams / 1000).toFixed(3)} kg`;

export const weightAmount = (grams: number, perKg: number) => Math.round((grams * perKg) / 1000);

// GST included in a GST-inclusive taxable amount (1/11th in Australia).
export const gstIncluded = (taxable: number) => Math.round(taxable / 11);
