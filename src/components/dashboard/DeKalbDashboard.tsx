"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { TaxLien } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  LogOut,
  TrendingUp,
  Building,
  DollarSign,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Database,
} from "lucide-react";

export function DeKalbDashboard() {
  const { user, signOut } = useAuth();
  const [taxLiens, setTaxLiens] = useState<TaxLien[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    totalCount: 0,
    totalPages: 0,
  });
  const [sortBy, setSortBy] = useState("scraped_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [totalTaxValue, setTotalTaxValue] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichmentStatus, setEnrichmentStatus] = useState({
    totalProperties: 0,
    enrichedProperties: 0,
    scoredProperties: 0,
    enrichmentRate: 0,
  });
  const [searchFilters, setSearchFilters] = useState({
    address: "",
    owner: "",
    taxDueOperator: "all" as "all" | "gt" | "lt" | "eq",
    taxDueValue: "",
  });

  useEffect(() => {
    fetchDeKalbData();
    fetchEnrichmentStatus();
  }, []); // Only fetch on initial mount

  // Separate effect for pagination/sorting changes (skip initial load)
  useEffect(() => {
    if (!isInitialLoad && pagination.page > 0) {
      fetchDeKalbData();
    }
  }, [pagination.page, sortBy, sortOrder, searchFilters]);

  const fetchDeKalbData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy,
        sortOrder,
      });

      // Add search filters
      if (searchFilters.address) {
        params.append("address", searchFilters.address);
      }
      if (searchFilters.owner) {
        params.append("owner", searchFilters.owner);
      }
      if (searchFilters.taxDueOperator !== "all" && searchFilters.taxDueValue) {
        params.append("taxDueOperator", searchFilters.taxDueOperator);
        params.append("taxDueValue", searchFilters.taxDueValue);
      }

      const response = await fetch(`/api/scrape/dekalb?${params}`);
      const data = await response.json();

      console.log("Dashboard received data:", data);

      // The GET endpoint doesn't return a success field, just the data directly
      if (data.taxLiens) {
        setTaxLiens(data.taxLiens);
        setPagination(data.pagination);
        setTotalTaxValue(data.totalTaxValue || 0);
        console.log("Set tax liens:", data.taxLiens.length);
        setIsInitialLoad(false); // Mark initial load as complete
      } else if (data.error) {
        console.error("API returned error:", data.error);
      }
    } catch (error) {
      console.error("Error fetching DeKalb data:", error);
    }
    setLoading(false);
  };

  const fetchEnrichmentStatus = async () => {
    try {
      const response = await fetch("/api/enrich/properties");
      const data = await response.json();
      setEnrichmentStatus(data);
    } catch (error) {
      console.error("Error fetching enrichment status:", error);
    }
  };

  const handleEnrichProperties = async () => {
    setEnriching(true);
    try {
      const response = await fetch("/api/enrich/properties", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ countyId: 1 }), // DeKalb County
      });

      const data = await response.json();

      if (data.success) {
        console.log("Property enrichment completed:", data.message);
        // Refresh data after enrichment
        await fetchDeKalbData();
        await fetchEnrichmentStatus();
      } else {
        console.error("Enrichment failed:", data.error);
        alert("Property enrichment failed. Please try again.");
      }
    } catch (error) {
      console.error("Error enriching properties:", error);
      alert("Property enrichment failed. Please try again.");
    }
    setEnriching(false);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination((prev) => ({ ...prev, page: newPage }));
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const handleSearchChange = (
    field: keyof typeof searchFilters,
    value: string,
  ) => {
    setSearchFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
    // Reset to first page when searching
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleClearSearch = () => {
    setSearchFilters({
      address: "",
      owner: "",
      taxDueOperator: "all",
      taxDueValue: "",
    });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleSortClick = (e: React.MouseEvent, field: string) => {
    e.preventDefault();
    e.stopPropagation();
    handleSort(field);
  };

  const handlePageClick = (e: React.MouseEvent, newPage: number) => {
    e.preventDefault();
    e.stopPropagation();
    handlePageChange(newPage);
  };

  const handleScrapeDeKalb = async () => {
    setScraping(true);
    try {
      const response = await fetch("/api/scrape/dekalb", {
        method: "POST",
      });
      const data = await response.json();

      if (data.success) {
        // Refresh data after scraping
        await fetchDeKalbData();
        alert(
          `Successfully scraped ${data.count} tax liens from DeKalb County!`,
        );
      } else {
        alert(`Scraping failed: ${data.error}`);
      }
    } catch (error) {
      console.error("Error scraping DeKalb:", error);
      alert("Scraping failed. Please try again.");
    }
    setScraping(false);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  // Use pagination data for total count instead of current page
  const totalProperties = pagination.totalCount;
  const avgInvestmentScore =
    taxLiens.length > 0
      ? taxLiens.reduce(
          (sum, lien) => sum + (lien.investment_score?.investment_score || 0),
          0,
        ) / taxLiens.length
      : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Mobile: Stack vertically, Desktop: Side by side */}
          <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                DeKalb County Tax Lien Dashboard
              </h1>
              <p className="text-sm text-gray-600">
                Tax lien investment analysis for DeKalb County, GA
              </p>
            </div>
            {/* Action buttons - wrap on mobile */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              {/* <Button
                onClick={handleEnrichProperties}
                disabled={enriching || totalProperties === 0}
                variant="default"
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Database
                  className={`h-4 w-4 mr-2 ${enriching ? "animate-pulse" : ""}`}
                />
                <span className="hidden sm:inline">
                  {enriching
                    ? "Enriching..."
                    : `Enrich Properties (${enrichmentStatus.enrichmentRate}%)`}
                </span>
                <span className="sm:hidden">
                  {enriching
                    ? "..."
                    : `Enrich (${enrichmentStatus.enrichmentRate}%)`}
                </span>
              </Button> */}
              <Button
                onClick={handleScrapeDeKalb}
                disabled={scraping}
                variant="outline"
                size="sm"
              >
                <RefreshCw
                  className={`h-4 w-4 sm:mr-2 ${scraping ? "animate-spin" : ""}`}
                />
                <span className="hidden sm:inline">
                  {scraping ? "Scraping..." : "Scrape DeKalb"}
                </span>
              </Button>
              <span className="hidden md:inline text-sm text-gray-600">
                Welcome, {user?.email}
              </span>
              <Button onClick={handleSignOut} variant="outline" size="sm">
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sign Out</span>
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
              <CardTitle className="text-sm font-medium">
                Total Properties
              </CardTitle>
              <Building className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalProperties.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                DeKalb County tax liens
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Tax Value
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(totalTaxValue)}
              </div>
              <p className="text-xs text-muted-foreground">
                Sum of all tax amounts due
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Avg Investment Score
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {avgInvestmentScore.toFixed(0)}
              </div>
              <p className="text-xs text-muted-foreground">
                Average investment opportunity score
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Instructions */}
        {/* <Card className="mb-8">
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
            <CardDescription>
              Click "Scrape DeKalb" to collect the latest tax lien data from
              DeKalb County
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <p>
                • <strong>Scrape DeKalb</strong> - Fetches latest tax lien data
                from DeKalb County website
              </p>
              <p>
                • <strong>View Properties</strong> - Browse available tax lien
                properties below
              </p>
              <p>
                • <strong>Investment Scores</strong> - Each property gets a
                1-100 investment score
              </p>
            </div>
          </CardContent>
        </Card> */}

        {/* Tax Liens Table */}
        <Card>
          <CardHeader>
            <CardTitle>DeKalb County Tax Liens</CardTitle>
            <CardDescription>
              {totalProperties} properties found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  placeholder="Search address..."
                  value={searchFilters.address}
                  onChange={(e) =>
                    handleSearchChange("address", e.target.value)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Owner
                </label>
                <input
                  type="text"
                  placeholder="Search owner..."
                  value={searchFilters.owner}
                  onChange={(e) => handleSearchChange("owner", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tax Due
                </label>
                <div className="flex space-x-2">
                  <select
                    value={searchFilters.taxDueOperator}
                    onChange={(e) =>
                      handleSearchChange("taxDueOperator", e.target.value)
                    }
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All</option>
                    <option value="gt">&gt;</option>
                    <option value="lt">&lt;</option>
                    <option value="eq">=</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Amount..."
                    value={searchFilters.taxDueValue}
                    onChange={(e) =>
                      handleSearchChange("taxDueValue", e.target.value)
                    }
                    disabled={searchFilters.taxDueOperator === "all"}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                </div>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleClearSearch}
                  variant="outline"
                  className="w-full"
                >
                  Clear Search
                </Button>
              </div>
            </div>
            {loading ? (
              <div className="text-center py-8">
                Loading DeKalb tax lien data...
              </div>
            ) : taxLiens.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <div className="mb-4">
                  <Building className="h-12 w-12 mx-auto text-gray-300" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No tax lien data found
                </h3>
                <p className="text-gray-500 mb-4">
                  Click "Scrape DeKalb" above to collect the latest tax lien
                  data from DeKalb County.
                </p>
                <Button onClick={handleScrapeDeKalb} disabled={scraping}>
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${scraping ? "animate-spin" : ""}`}
                  />
                  {scraping ? "Scraping..." : "Scrape DeKalb Now"}
                </Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th
                          className="text-left py-3 px-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={(e) =>
                            handleSortClick(e, "property_address")
                          }
                        >
                          <div className="flex items-center">
                            Property Address
                            {sortBy === "property_address" && (
                              <ArrowUpDown className="ml-1 h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th
                          className="text-left py-3 px-4 font-medium cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={(e) => handleSortClick(e, "owner_name")}
                        >
                          <div className="flex items-center">
                            Owner
                            {sortBy === "owner_name" && (
                              <ArrowUpDown className="ml-1 h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th
                          className="text-right py-3 px-4 font-medium cursor-pointer hover:bg-gray-50"
                          onClick={(e) => handleSortClick(e, "tax_amount_due")}
                        >
                          <div className="flex items-center justify-end">
                            Tax Due
                            {sortBy === "tax_amount_due" && (
                              <ArrowUpDown className="ml-1 h-3 w-3" />
                            )}
                          </div>
                        </th>
                        <th className="text-right py-3 px-4 font-medium">
                          Est. Value
                        </th>
                        <th className="text-right py-3 px-4 font-medium">
                          LTV
                        </th>
                        <th className="text-right py-3 px-4 font-medium">
                          Score
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxLiens.map((lien) => (
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
                                  {lien.city}, {lien.zip}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-700">
                            {lien.owner_name}
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
                            {lien.investment_score?.ltv !== undefined
                              ? formatPercent(lien.investment_score.ltv)
                              : "N/A"}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {lien.investment_score?.investment_score ? (
                              <span
                                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                  lien.investment_score.investment_score >= 80
                                    ? "bg-green-100 text-green-800"
                                    : lien.investment_score.investment_score >=
                                        60
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

                <div>
                  {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t">
                      <div className="text-sm text-gray-700">
                        Showing {(pagination.page - 1) * pagination.limit + 1}{" "}
                        to{" "}
                        {Math.min(
                          pagination.page * pagination.limit,
                          pagination.totalCount,
                        )}{" "}
                        of {pagination.totalCount} results
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) =>
                            handlePageClick(e, pagination.page - 1)
                          }
                          disabled={pagination.page === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>
                        <span className="text-sm font-medium">
                          Page {pagination.page} of {pagination.totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) =>
                            handlePageClick(e, pagination.page + 1)
                          }
                          disabled={pagination.page === pagination.totalPages}
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
