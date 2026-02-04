'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { TaxLien, County } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { LogOut, TrendingUp, Building, DollarSign } from 'lucide-react'

export function Dashboard() {
  const { user, signOut } = useAuth()
  const [counties, setCounties] = useState<County[]>([])
  const [selectedCounty, setSelectedCounty] = useState<string>('all')
  const [taxLiens, setTaxLiens] = useState<TaxLien[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCounties()
    fetchTaxLiens()
  }, [])

  const fetchCounties = async () => {
    const { data, error } = await supabase
      .from('counties')
      .select('*')
      .order('name')
    
    if (data) setCounties(data)
  }

  const fetchTaxLiens = async (countyId?: string) => {
    setLoading(true)
    let query = supabase
      .from('tax_liens')
      .select(`
        *,
        county:counties(name),
        property:properties(*),
        investment_score:investment_scores(*)
      `)
      .order('scraped_at', { ascending: false })

    if (countyId && countyId !== 'all') {
      query = query.eq('county_id', parseInt(countyId))
    }

    const { data, error } = await query.limit(50)
    
    if (data) setTaxLiens(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchTaxLiens(selectedCounty)
  }, [selectedCounty])

  const handleSignOut = async () => {
    await signOut()
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

        {/* County Filter */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Filter by County</CardTitle>
            <CardDescription>
              Select a county to view tax lien properties from that area
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={selectedCounty} onValueChange={setSelectedCounty}>
              <SelectTrigger className="w-full md:w-50">
                <SelectValue placeholder="Select a county" />
              </SelectTrigger>
              <SelectContent>
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
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">Property Address</th>
                      <th className="text-left py-3 px-4 font-medium">Owner</th>
                      <th className="text-left py-3 px-4 font-medium">County</th>
                      <th className="text-right py-3 px-4 font-medium">Tax Due</th>
                      <th className="text-right py-3 px-4 font-medium">Est. Value</th>
                      <th className="text-right py-3 px-4 font-medium">LTV</th>
                      <th className="text-right py-3 px-4 font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxLiens.map((lien) => (
                      <tr key={lien.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div>
                            <div className="font-medium">{lien.property_address}</div>
                            {lien.city && lien.zip && (
                              <div className="text-gray-500 text-xs">
                                {lien.city}, {lien.zip}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">{lien.owner_name}</td>
                        <td className="py-3 px-4">{lien.county?.name}</td>
                        <td className="py-3 px-4 text-right">
                          {formatCurrency(lien.tax_amount_due)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {lien.property?.estimated_value 
                            ? formatCurrency(lien.property.estimated_value)
                            : 'N/A'
                          }
                        </td>
                        <td className="py-3 px-4 text-right">
                          {lien.investment_score?.ltv !== undefined
                            ? formatPercent(lien.investment_score.ltv)
                            : 'N/A'
                          }
                        </td>
                        <td className="py-3 px-4 text-right">
                          {lien.investment_score?.investment_score ? (
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              lien.investment_score.investment_score >= 80
                                ? 'bg-green-100 text-green-800'
                                : lien.investment_score.investment_score >= 60
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {lien.investment_score.investment_score}
                            </span>
                          ) : (
                            'N/A'
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
