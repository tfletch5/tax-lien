import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value / 100)
}

export function calculateLTV(mortgageBalance: number, taxAmount: number, estimatedValue: number): number {
  if (estimatedValue === 0) return 100
  return ((mortgageBalance + taxAmount) / estimatedValue) * 100
}

export function calculateEquity(estimatedValue: number, mortgageBalance: number, taxAmount: number): number {
  return estimatedValue - mortgageBalance - taxAmount
}

export function calculateInvestmentScore(
  ltv: number,
  equity: number,
  taxAmount: number,
  estimatedValue: number,
  propertyType: string,
  countyName: string
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {}
  
  // LTV Score (30% weight) - Lower LTV = higher score
  let ltvScore = 0
  if (ltv < 50) ltvScore = 100
  else if (ltv < 70) ltvScore = 80
  else if (ltv < 85) ltvScore = 60
  else if (ltv < 95) ltvScore = 40
  else ltvScore = 20
  breakdown['ltv'] = ltvScore * 0.3
  
  // Equity Score (25% weight) - Higher equity = higher score
  let equityScore = 0
  const equityRatio = (equity / estimatedValue) * 100
  if (equityRatio > 50) equityScore = 100
  else if (equityRatio > 30) equityScore = 80
  else if (equityRatio > 15) equityScore = 60
  else if (equityRatio > 5) equityScore = 40
  else equityScore = 20
  breakdown['equity'] = equityScore * 0.25
  
  // Tax vs Value Score (20% weight) - Lower tax/value ratio = better
  let taxScore = 0
  const taxRatio = (taxAmount / estimatedValue) * 100
  if (taxRatio < 2) taxScore = 100
  else if (taxRatio < 5) taxScore = 80
  else if (taxRatio < 10) taxScore = 60
  else if (taxRatio < 15) taxScore = 40
  else taxScore = 20
  breakdown['taxRatio'] = taxScore * 0.2
  
  // Property Type Score (10% weight)
  let propertyScore = 50 // default
  if (propertyType?.toLowerCase().includes('single family')) propertyScore = 100
  else if (propertyType?.toLowerCase().includes('multi')) propertyScore = 80
  else if (propertyType?.toLowerCase().includes('commercial')) propertyScore = 60
  else if (propertyType?.toLowerCase().includes('land')) propertyScore = 40
  breakdown['propertyType'] = propertyScore * 0.1
  
  // Location Score (10% weight) - Based on county
  let locationScore = 70 // default
  const highPerformingCounties = ['Fulton', 'Dekalb', 'Cobb']
  if (highPerformingCounties.includes(countyName)) locationScore = 90
  else if (countyName === 'Gwinnett') locationScore = 80
  else if (countyName === 'Clayton') locationScore = 60
  breakdown['location'] = locationScore * 0.1
  
  // Recency Score (5% weight) - Newer listings score slightly higher
  breakdown['recency'] = 75 * 0.05
  
  const totalScore = Object.values(breakdown).reduce((sum, score) => sum + score, 0)
  
  return {
    score: Math.round(totalScore),
    breakdown
  }
}
