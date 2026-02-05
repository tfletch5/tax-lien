'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { TaxLien, County } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { LogOut, TrendingUp, Building, DollarSign, ArrowUpDown, Info, Download, Loader2 } from 'lucide-react'

const DEFAULT_COUNTIES: County[] = [
    {
        "id": 5,
        "name": "Clayton",
        "state": "GA",
        "scrape_url": "https://publicaccess.claytoncountyga.gov/content/PDF/",
        "last_scraped_at": ""
    },
    {
        "id": 3,
        "name": "Cobb",
        "state": "GA",
        "scrape_url": "https://www.cobbtax.gov/property/tax_sale/index.php",
        "last_scraped_at": ""
    },
    {
        "id": 1,
        "name": "DeKalb",
        "state": "GA",
        "scrape_url": "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
        "last_scraped_at": ""
    },
    {
        "id": 4,
        "name": "Fulton",
        "state": "GA",
        "scrape_url": "https://fcsoga.org/tax-sales/",
        "last_scraped_at": ""
    },
    {
        "id": 2,
        "name": "Gwinnett",
        "state": "GA",
        "scrape_url": "https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales",
        "last_scraped_at": ""
    }
]
export function Dashboard() {
  const { user, signOut } = useAuth()
  const [counties, setCounties] = useState<County[]>([])
  const [selectedCounty, setSelectedCounty] = useState<string>('all')
  const [taxLiens, setTaxLiens] = useState<TaxLien[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<string>('scraped_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [scrapeCounty, setScrapeCounty] = useState<string>('')
  const [scraping, setScraping] = useState(false)
  const [scrapeMessage, setScrapeMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    fetchCounties()
    fetchTaxLiens()
  }, [])

  useEffect(() => {
    fetchTaxLiens()
  }, [selectedCounty, sortBy, sortOrder])

  const fetchCounties = async () => {
    // try {
    //   const { data, error } = await supabase
    //     .from('counties')
    //     .select('*')
    //     .order('name')
      
    //   if (error) {
    //     console.error('Error fetching counties:', error)
    //     // Don't throw - just log and return empty array
    //     setCounties(DEFAULT_COUNTIES)
    //     return
    //   }
      
    //   if (data) {
    //     console.log('Fetched counties:', data.length)
    //     setCounties(data)
    //   } else {
    //     console.warn('No counties data returned')
    //     setCounties(DEFAULT_COUNTIES)
    //   }
    // } catch (error) {
    //   console.error('Error fetching counties:', error)
    //   // Set empty array on error to prevent UI issues
    // }
    setCounties(DEFAULT_COUNTIES)
  }

  const fetchTaxLiens = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        sortBy,
        sortOrder,
        limit: '100',
      })

      if (selectedCounty && selectedCounty !== 'all') {
        params.append('countyId', selectedCounty)
      } else {
        params.append('countyId', 'all')
      }

      const response = await fetch(`/api/tax-liens?${params}`)
      const data = await response.json()

      console.log('Dashboard received data:', data)

      if (data.success && data.taxLiens) {
        console.log('Set tax liens:', data.taxLiens.length)
        setTaxLiens(data.taxLiens)
      } else if (data.error) {
        console.error('API returned error:', data.error)
        setTaxLiens([])
      } else {
        console.log('No data in response')
        setTaxLiens([])
      }
    } catch (error) {
      console.error('Error fetching tax liens:', error)
      setTaxLiens([])
    }
    setLoading(false)
  }

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  const handleSortClick = (e: React.MouseEvent, field: string) => {
    e.preventDefault()
    e.stopPropagation()
    handleSort(field)
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const handleScrape = async () => {
    if (!scrapeCounty) {
      setScrapeMessage({ type: 'error', text: 'Please select a county to scrape' })
      return
    }

    setScraping(true)
    setScrapeMessage(null)

    try {
      // Map county names to their API endpoints
      const countyApiMap: Record<string, string> = {
        'DeKalb': '/api/scrape/dekalb',
        'Gwinnett': '/api/scrape/gwinnett',
        'Cobb': '/api/scrape/cobb',
        'Fulton': '/api/scrape/fulton',
        'Clayton': '/api/scrape/clayton',
      }

      const countyName = counties.find(c => c.id.toString() === scrapeCounty)?.name || ''
      const apiEndpoint = countyApiMap[countyName]

      if (!apiEndpoint) {
        throw new Error(`No scraper available for ${countyName}`)
      }

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (data.success) {
        setScrapeMessage({ 
          type: 'success', 
          text: `Successfully scraped ${data.count || 0} tax liens from ${countyName}` 
        })
        // Refresh the tax liens data after scraping
        setTimeout(() => {
          fetchTaxLiens()
          fetchCounties() // Refresh counties to update last_scraped_at
        }, 2000)
      } else {
        throw new Error(data.error || 'Scraping failed')
      }
    } catch (error) {
      console.error('Scraping error:', error)
      setScrapeMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to scrape county data' 
      })
    } finally {
      setScraping(false)
    }
  }

  const totalProperties = taxLiens.length
  const totalTaxValue = taxLiens.reduce((sum, lien) => sum + (lien.tax_amount_due || 0), 0)
  const avgInvestmentScore = taxLiens.length > 0 
    ? taxLiens.reduce((sum, lien) => sum + (lien.investment_score?.investment_score || 0), 0) / taxLiens.length
    : 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Tax Lien Dashboard</h1>
              <p className="text-sm text-gray-600">Georgia County Tax Lien Investment Analysis</p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {user?.email}</span>
              <Button onClick={handleSignOut} variant="outline" size="sm">
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Properties</CardTitle>
              <Building className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalProperties.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Tax lien properties available
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Tax Value</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(totalTaxValue)}</div>
              <p className="text-xs text-muted-foreground">
                Sum of all tax amounts due
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Investment Score</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgInvestmentScore.toFixed(0)}</div>
              <p className="text-xs text-muted-foreground">
                Average investment opportunity score
              </p>
            </CardContent>
          </Card>
        </div>

        {/* County Filter and Scrape */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Filter by County</CardTitle>
              <CardDescription>
                Select a county to view tax lien properties from that area
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={selectedCounty} onValueChange={setSelectedCounty}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a county" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="all">All Counties</SelectItem>
                  {counties.map((county) => (
                    <SelectItem key={county.id} value={county.id.toString()}>
                      {county.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scrape County Data</CardTitle>
              <CardDescription>
                Select a county and scrape the latest tax lien data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={scrapeCounty} onValueChange={setScrapeCounty}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a county to scrape" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {counties.map((county) => {
                    const lastScraped = county.last_scraped_at 
                      ? new Date(county.last_scraped_at).toLocaleDateString()
                      : 'Never'
                    return (
                      <SelectItem key={county.id} value={county.id.toString()}>
                        {county.name} {lastScraped !== 'Never' && `(${lastScraped})`}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <Button 
                onClick={handleScrape} 
                disabled={!scrapeCounty || scraping}
                className="w-full"
              >
                {scraping ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Scraping...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Scrape
                  </>
                )}
              </Button>
              {scrapeMessage && (
                <div className={`text-sm p-3 rounded-md ${
                  scrapeMessage.type === 'success' 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {scrapeMessage.text}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tax Liens Table */}
        <Card>
          <CardHeader>
            <CardTitle>Tax Lien Properties</CardTitle>
            <CardDescription>
              {selectedCounty === 'all' ? 'All counties' : counties.find(c => c.id.toString() === selectedCounty)?.name} 
              {' • '} {totalProperties} properties found
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading tax lien data...</div>
            ) : taxLiens.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No tax lien properties found for the selected county.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th
                        className="text-left py-3 px-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={(e) => handleSortClick(e, "property_address")}
                      >
                        <div className="flex items-center">
                          Property Address
                          <ArrowUpDown 
                            className={`ml-1 h-3 w-3 ${
                              sortBy === "property_address" 
                                ? "text-gray-900" 
                                : "text-gray-400"
                            }`} 
                          />
                        </div>
                      </th>
                      <th
                        className="text-left py-3 px-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={(e) => handleSortClick(e, "owner_name")}
                      >
                        <div className="flex items-center">
                          Owner
                          <ArrowUpDown 
                            className={`ml-1 h-3 w-3 ${
                              sortBy === "owner_name" 
                                ? "text-gray-900" 
                                : "text-gray-400"
                            }`} 
                          />
                        </div>
                      </th>
                      <th className="text-left py-3 px-4 font-medium">
                        County
                      </th>
                      <th
                        className="text-right py-3 px-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={(e) => handleSortClick(e, "tax_amount_due")}
                      >
                        <div className="flex items-center justify-end">
                          Tax Due
                          <ArrowUpDown 
                            className={`ml-1 h-3 w-3 ${
                              sortBy === "tax_amount_due" 
                                ? "text-gray-900" 
                                : "text-gray-400"
                            }`} 
                          />
                        </div>
                      </th>
                      <th className="text-right py-3 px-4 font-medium">
                        Est. Value
                      </th>
                      <th className="text-right py-3 px-4 font-medium">
                        <div className="flex items-center justify-end gap-1">
                          LTV
                          <Tooltip 
                            content="Loan-to-Value ratio: The percentage of the property's estimated value that is covered by mortgage debt plus the tax lien. Lower LTV (under 70%) indicates better investment opportunity as there's more equity in the property."
                            position="bottom"
                          >
                            <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                          </Tooltip>
                        </div>
                      </th>
                      <th
                        className="text-right py-3 px-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={(e) => handleSortClick(e, "property_confidence")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Confidence
                          <ArrowUpDown 
                            className={`h-3 w-3 ${
                              sortBy === "property_confidence" 
                                ? "text-gray-900" 
                                : "text-gray-400"
                            }`} 
                          />
                          <Tooltip 
                            content="Property Valuation Confidence: A score (0-100) from the Real Estate API indicating how reliable the Automated Valuation Model (AVM) estimate is. Higher scores mean more reliable property value data. Green (80+), Yellow (60-79), Red (&lt;60)."
                            position="bottom"
                          >
                            <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                          </Tooltip>
                        </div>
                      </th>
                      <th
                        className="text-right py-3 px-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={(e) => handleSortClick(e, "investment_score")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Investment Score
                          <ArrowUpDown 
                            className={`h-3 w-3 ${
                              sortBy === "investment_score" 
                                ? "text-gray-900" 
                                : "text-gray-400"
                            }`} 
                          />
                          <Tooltip 
                            content="Investment Opportunity Score: A comprehensive score (1-100) that evaluates the tax lien as an investment opportunity. Based on LTV (30%), equity (25%), tax-to-value ratio (20%), property type (10%), location (10%), and data recency (5%). Higher scores indicate better investment opportunities. Green (80+), Yellow (60-79), Red (&lt;60)."
                            position="bottom"
                          >
                            <Info className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help" />
                          </Tooltip>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxLiens.map((lien: any) => (
                      <tr
                        key={lien.id}
                        className="border-b hover:bg-blue-50 hover:shadow-sm transition-all duration-150 cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div>
                            <div className="font-medium text-gray-900">
                              {lien.property_address}
                            </div>
                            {lien.city && lien.zip && (
                              <div className="text-gray-500 text-xs">
                                {lien.city}, {lien.state} {lien.zip}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-gray-700">
                          {lien.owner_name}
                        </td>
                        <td className="py-3 px-4 text-gray-700">
                          {lien.county?.name}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-gray-900">
                          {formatCurrency(lien.tax_amount_due)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-600">
                          {lien.property?.estimated_value
                            ? formatCurrency(lien.property.estimated_value)
                            : "N/A"}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-600">
                          {lien.investment_score?.ltv !== undefined && lien.investment_score.ltv !== null
                            ? formatPercent(lien.investment_score.ltv)
                            : "N/A"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {lien.property?.confidence ? (
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                lien.property.confidence >= 80
                                  ? "bg-green-100 text-green-800"
                                  : lien.property.confidence >= 60
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {lien.property.confidence}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">N/A</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {lien.investment_score?.investment_score !== undefined ? (
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                lien.investment_score.investment_score >= 80
                                  ? "bg-green-100 text-green-800"
                                  : lien.investment_score.investment_score >= 60
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {lien.investment_score.investment_score}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">N/A</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
