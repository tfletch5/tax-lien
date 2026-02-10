"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { TaxLien, County } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  LogOut,
  TrendingUp,
  Building,
  DollarSign,
  ArrowUpDown,
  Info,
  Download,
  Loader2,
  Map,
  ExternalLink,
} from "lucide-react";

const DEFAULT_COUNTIES: County[] = [
  {
    id: 5,
    name: "Clayton",
    state: "GA",
    scrape_url: "https://publicaccess.claytoncountyga.gov/content/PDF/",
    last_scraped_at: "",
  },
  {
    id: 3,
    name: "Cobb",
    state: "GA",
    scrape_url: "https://www.cobbtax.gov/property/tax_sale/index.php",
    last_scraped_at: "",
  },
  {
    id: 1,
    name: "DeKalb",
    state: "GA",
    scrape_url:
      "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
    last_scraped_at: "",
  },
  {
    id: 4,
    name: "Fulton",
    state: "GA",
    scrape_url: "https://fcsoga.org/tax-sales/",
    last_scraped_at: "",
  },
  {
    id: 2,
    name: "Gwinnett",
    state: "GA",
    scrape_url:
      "https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales",
    last_scraped_at: "",
  },
];
export function Dashboard() {
  const { user, signOut } = useAuth();
  const [counties, setCounties] = useState<County[]>([]);
  const [selectedCounty, setSelectedCounty] = useState<string>("all");
  const [taxLiens, setTaxLiens] = useState<TaxLien[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>("scraped_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [scrapeCounty, setScrapeCounty] = useState<string>("");
  const [scraping, setScraping] = useState(false);
  const [scrapeMessage, setScrapeMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [selectedLien, setSelectedLien] = useState<TaxLien | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [fultonManualInput, setFultonManualInput] = useState<string>("");

  useEffect(() => {
    fetchCounties();
    fetchTaxLiens();
  }, []);

  useEffect(() => {
    fetchTaxLiens();
  }, [selectedCounty, sortBy, sortOrder]);

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
    setCounties(DEFAULT_COUNTIES);
  };

  const fetchTaxLiens = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sortBy,
        sortOrder,
        limit: "100",
      });

      if (selectedCounty && selectedCounty !== "all") {
        params.append("countyId", selectedCounty);
      } else {
        params.append("countyId", "all");
      }

      const response = await fetch(`/api/tax-liens?${params}`);
      const data = await response.json();

      console.log("Dashboard received data:", data);

      if (data.success && data.taxLiens) {
        console.log("Set tax liens:", data.taxLiens.length);
        setTaxLiens(data.taxLiens);
      } else if (data.error) {
        console.error("API returned error:", data.error);
        setTaxLiens([]);
      } else {
        console.log("No data in response");
        setTaxLiens([]);
      }
    } catch (error) {
      console.error("Error fetching tax liens:", error);
      setTaxLiens([]);
    }
    setLoading(false);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const handleSortClick = (e: React.MouseEvent, field: string) => {
    e.preventDefault();
    e.stopPropagation();
    handleSort(field);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const getGoogleMapsUrl = (
    address: string,
    city?: string,
    state?: string,
    zip?: string,
  ) => {
    const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  };

  const getZillowUrl = (
    address: string,
    city?: string,
    state?: string,
    zip?: string,
  ) => {
    const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
    return `https://www.zillow.com/homes/${encodeURIComponent(fullAddress)}_rb/`;
  };

  const handleScrape = async () => {
    if (!scrapeCounty) {
      setScrapeMessage({
        type: "error",
        text: "Please select a county to scrape",
      });
      return;
    }

    const countyName =
      counties.find((c) => c.id.toString() === scrapeCounty)?.name || "";

    // For Fulton County, check if manual input is provided
    if (countyName === "Fulton") {
      if (!fultonManualInput.trim()) {
        setScrapeMessage({
          type: "error",
          text: "Please paste the Fulton County records in the text area below",
        });
        return;
      }
    }

    setScraping(true);
    setScrapeMessage(null);

    try {
      let apiEndpoint: string;
      let requestBody: any = {};

      if (countyName === "Fulton" && fultonManualInput.trim()) {
        // Use manual input endpoint for Fulton
        apiEndpoint = "/api/scrape/fulton/manual";
        requestBody = { data: fultonManualInput };
      } else {
        // Use regular scraping endpoints
        const countyApiMap: Record<string, string> = {
          DeKalb: "/api/scrape/dekalb",
          Gwinnett: "/api/scrape/gwinnett",
          Cobb: "/api/scrape/cobb",
          Fulton: "/api/scrape/fulton",
          Clayton: "/api/scrape/clayton",
        };
        apiEndpoint = countyApiMap[countyName];
        if (!apiEndpoint) {
          throw new Error(`No scraper available for ${countyName}`);
        }
      }

      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body:
          Object.keys(requestBody).length > 0
            ? JSON.stringify(requestBody)
            : undefined,
      });

      const data = await response.json();

      if (data.success) {
        setScrapeMessage({
          type: "success",
          text: `Successfully processed ${data.count || 0} tax liens from ${countyName}`,
        });
        // Clear manual input after successful processing
        if (countyName === "Fulton") {
          setFultonManualInput("");
        }
        // Refresh the tax liens data after scraping
        setTimeout(() => {
          fetchTaxLiens();
          fetchCounties(); // Refresh counties to update last_scraped_at
        }, 2000);
      } else {
        throw new Error(data.error || "Processing failed");
      }
    } catch (error) {
      console.error("Scraping error:", error);
      setScrapeMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to process county data",
      });
    } finally {
      setScraping(false);
    }
  };

  const totalProperties = taxLiens.length;
  const totalTaxValue = taxLiens.reduce(
    (sum, lien) => sum + (lien.tax_amount_due || 0),
    0,
  );
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Tax Lien Dashboard
              </h1>
              <p className="text-sm text-gray-600">
                Georgia County Tax Lien Investment Analysis
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                Welcome, {user?.email}
              </span>
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
                Tax lien properties available
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
                      : "Never";
                    return (
                      <SelectItem key={county.id} value={county.id.toString()}>
                        {county.name}{" "}
                        {lastScraped !== "Never" && `(${lastScraped})`}
                      </SelectItem>
                    );
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

              {/* Fulton County Manual Input */}
              {counties.find((c) => c.id.toString() === scrapeCounty)?.name ===
                "Fulton" && (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-gray-700">
                    Fulton County Manual Input
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    Paste the tax lien records from the Fulton County PDF (one
                    per line)
                  </div>
                  <Textarea
                    placeholder="Example:&#10;0326-55949 14-0151-0007-024-1 0 ORLANDO ST SW&#10;0326-55950 14-0151-0007-025-8 0 ORLANDO ST SW&#10;0326-56559 14-0175-0017-090-2 1821 PINEDALE DR NW"
                    value={fultonManualInput}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setFultonManualInput(e.target.value)
                    }
                    className="min-h-[120px] text-sm font-mono"
                    rows={6}
                  />
                  <div className="text-xs text-gray-400">
                    Format: SALE_NUMBER PARCEL_ID ADDRESS (one per line)
                  </div>
                </div>
              )}

              {scrapeMessage && (
                <div
                  className={`text-sm p-3 rounded-md ${
                    scrapeMessage.type === "success"
                      ? "bg-green-50 text-green-800 border border-green-200"
                      : "bg-red-50 text-red-800 border border-red-200"
                  }`}
                >
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
              {selectedCounty === "all"
                ? "All counties"
                : counties.find((c) => c.id.toString() === selectedCounty)
                    ?.name}
              {" • "} {totalProperties} properties found
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
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 z-10 shadow-sm">
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
                        onClick={(e) =>
                          handleSortClick(e, "property_confidence")
                        }
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
                        onClick={() => {
                          setSelectedLien(lien);
                          setModalOpen(true);
                        }}
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
                          {lien.investment_score?.ltv !== undefined &&
                          lien.investment_score.ltv !== null
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
                          {lien.investment_score?.investment_score !==
                          undefined ? (
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

        {/* Property Details Modal */}
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="max-w-4xl">
            <DialogClose onClose={() => setModalOpen(false)} />
            <DialogHeader>
              <DialogTitle>Property Details</DialogTitle>
              <DialogDescription>
                Complete information about the selected tax lien property
              </DialogDescription>
            </DialogHeader>
            {selectedLien && (
              <div className="px-8 py-6 space-y-8">
                {/* Basic Information */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-blue-500" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      Basic Information
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 gap-5">
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 rounded-xl p-4 border border-blue-100/50">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                        Property Address
                      </label>
                      <div className="flex items-center gap-3">
                        <p className="text-base font-medium text-gray-900">
                          {selectedLien.property_address || "N/A"}
                        </p>
                        {selectedLien.property_address && (
                          <div className="flex items-center gap-2">
                            <Tooltip
                              content="View on Google Maps"
                              position="top"
                            >
                              <a
                                href={getGoogleMapsUrl(
                                  selectedLien.property_address,
                                  selectedLien.city || undefined,
                                  "GA",
                                  selectedLien.zip || undefined,
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
                              >
                                <Map className="h-4 w-4" />
                              </a>
                            </Tooltip>
                            <Tooltip content="View on Zillow" position="top">
                              <a
                                href={getZillowUrl(
                                  selectedLien.property_address,
                                  selectedLien.city || undefined,
                                  "GA",
                                  selectedLien.zip || undefined,
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                      {(selectedLien.city || selectedLien.zip) && (
                        <p className="text-sm text-gray-600 mt-2">
                          {selectedLien.city || ""}
                          {selectedLien.city && selectedLien.zip ? ", " : ""}
                          GA {selectedLien.zip || ""}
                        </p>
                      )}
                    </div>
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50/50 rounded-xl p-4 border border-purple-100/50">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                        Owner Name
                      </label>
                      <p className="text-base font-medium text-gray-900">
                        {selectedLien.owner_name || "N/A"}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                        Parcel ID
                      </label>
                      <p className="text-base font-medium text-gray-900 font-mono">
                        {selectedLien.parcel_id}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                        County
                      </label>
                      <p className="text-base font-medium text-gray-900">
                        {selectedLien.county?.name || "N/A"}
                      </p>
                    </div>
                    <div className="bg-gradient-to-br from-red-50 to-orange-50/50 rounded-xl p-4 border border-red-100/50">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                        Tax Amount Due
                      </label>
                      <p className="text-xl font-bold text-red-700">
                        {formatCurrency(selectedLien.tax_amount_due)}
                      </p>
                    </div>
                    {selectedLien.sale_date && (
                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                          Sale Date
                        </label>
                        <p className="text-base font-medium text-gray-900">
                          {new Date(
                            selectedLien.sale_date,
                          ).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Property Details */}
                {selectedLien.property && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-1 rounded-full bg-green-500" />
                      <h3 className="text-lg font-semibold text-gray-900">
                        Property Details
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                      {selectedLien.property.estimated_value !== undefined && (
                        <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 rounded-xl p-4 border border-emerald-100/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Estimated Value
                          </label>
                          <p className="text-xl font-bold text-emerald-700">
                            {formatCurrency(
                              selectedLien.property.estimated_value,
                            )}
                          </p>
                        </div>
                      )}
                      {selectedLien.property.confidence !== undefined && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Confidence Score
                          </label>
                          <p className="text-base text-gray-900 mt-1">
                            <span
                              className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold shadow-sm ${
                                selectedLien.property.confidence >= 80
                                  ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white"
                                  : selectedLien.property.confidence >= 60
                                    ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-white"
                                    : "bg-gradient-to-r from-red-500 to-rose-500 text-white"
                              }`}
                            >
                              {selectedLien.property.confidence}
                            </span>
                          </p>
                        </div>
                      )}
                      {selectedLien.property.last_sale_price !== undefined &&
                        selectedLien.property.last_sale_price > 0 && (
                          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100/50">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                              Last Sale Price
                            </label>
                            <p className="text-lg font-semibold text-blue-700">
                              {formatCurrency(
                                selectedLien.property.last_sale_price,
                              )}
                            </p>
                          </div>
                        )}
                      {selectedLien.property.last_sale_date && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Last Sale Date
                          </label>
                          <p className="text-base font-medium text-gray-900">
                            {new Date(
                              selectedLien.property.last_sale_date,
                            ).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                      {selectedLien.property.year_built && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Year Built
                          </label>
                          <p className="text-base font-medium text-gray-900">
                            {selectedLien.property.year_built}
                          </p>
                        </div>
                      )}
                      {selectedLien.property.property_type && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Property Type
                          </label>
                          <p className="text-base font-medium text-gray-900">
                            {selectedLien.property.property_type}
                          </p>
                        </div>
                      )}
                      {selectedLien.property.bedrooms !== undefined && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Bedrooms
                          </label>
                          <p className="text-base font-medium text-gray-900">
                            {selectedLien.property.bedrooms}
                          </p>
                        </div>
                      )}
                      {selectedLien.property.bathrooms !== undefined && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Bathrooms
                          </label>
                          <p className="text-base font-medium text-gray-900">
                            {selectedLien.property.bathrooms}
                          </p>
                        </div>
                      )}
                      {selectedLien.property.sqft !== undefined &&
                        selectedLien.property.sqft > 0 && (
                          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                              Square Feet
                            </label>
                            <p className="text-base font-medium text-gray-900">
                              {selectedLien.property.sqft.toLocaleString()} sq
                              ft
                            </p>
                          </div>
                        )}
                      {selectedLien.property.lot_size_sqft !== undefined &&
                        selectedLien.property.lot_size_sqft > 0 && (
                          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                              Lot Size
                            </label>
                            <p className="text-base font-medium text-gray-900">
                              {selectedLien.property.lot_size_sqft.toLocaleString()}{" "}
                              sq ft
                            </p>
                          </div>
                        )}
                      {selectedLien.property.mortgage_balance !== undefined &&
                        selectedLien.property.mortgage_balance > 0 && (
                          <div className="bg-amber-50 rounded-xl p-4 border border-amber-100/50">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                              Mortgage Balance
                            </label>
                            <p className="text-lg font-semibold text-amber-700">
                              {formatCurrency(
                                selectedLien.property.mortgage_balance,
                              )}
                            </p>
                          </div>
                        )}
                    </div>
                  </div>
                )}

                {/* Investment Score */}
                {selectedLien.investment_score && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-1 rounded-full bg-amber-500" />
                      <h3 className="text-lg font-semibold text-gray-900">
                        Investment Analysis
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                      <div className="bg-gradient-to-br from-violet-50 to-purple-50/50 rounded-xl p-4 border border-violet-100/50">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                          Investment Score
                        </label>
                        <p className="text-base text-gray-900 mt-1">
                          <span
                            className={`inline-flex items-center px-4 py-2 rounded-xl text-base font-bold shadow-md ${
                              selectedLien.investment_score.investment_score >=
                              80
                                ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white"
                                : selectedLien.investment_score
                                      .investment_score >= 60
                                  ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-white"
                                  : "bg-gradient-to-r from-red-500 to-rose-500 text-white"
                            }`}
                          >
                            {selectedLien.investment_score.investment_score}
                          </span>
                        </p>
                      </div>
                      {selectedLien.investment_score.ltv !== undefined && (
                        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Loan-to-Value (LTV)
                          </label>
                          <p className="text-xl font-bold text-indigo-700">
                            {formatPercent(selectedLien.investment_score.ltv)}
                          </p>
                        </div>
                      )}
                      {selectedLien.investment_score.equity_estimate !==
                        undefined && (
                        <div className="bg-gradient-to-br from-teal-50 to-cyan-50/50 rounded-xl p-4 border border-teal-100/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Estimated Equity
                          </label>
                          <p className="text-xl font-bold text-teal-700">
                            {formatCurrency(
                              selectedLien.investment_score.equity_estimate,
                            )}
                          </p>
                        </div>
                      )}
                      {selectedLien.investment_score.calculated_at && (
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/50">
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                            Calculated At
                          </label>
                          <p className="text-base font-medium text-gray-900">
                            {new Date(
                              selectedLien.investment_score.calculated_at,
                            ).toLocaleString()}
                          </p>
                        </div>
                      )}
                    </div>
                    {selectedLien.investment_score.score_breakdown && (
                      <div className="mt-6 bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl p-5 border border-gray-200/50">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 block">
                          Score Breakdown
                        </label>
                        <div className="space-y-3">
                          {Object.entries(
                            selectedLien.investment_score.score_breakdown,
                          ).map(([key, value]) => (
                            <div
                              key={key}
                              className="flex justify-between items-center bg-white rounded-lg p-3 border border-gray-100 shadow-sm"
                            >
                              <span className="text-sm font-medium text-gray-700 capitalize">
                                {key.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                              <span className="text-sm font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded-full">
                                {value as number}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Legal Description */}
                {selectedLien.legal_description && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-1 rounded-full bg-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-900">
                        Legal Description
                      </h3>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-5 border border-gray-200/50">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {selectedLien.legal_description}
                      </p>
                    </div>
                  </div>
                )}

                {/* Metadata */}
                <div className="pt-6 border-t border-gray-200/60">
                  <div className="grid grid-cols-2 gap-5">
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200/50">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                        Scraped At
                      </label>
                      <p className="text-sm font-medium text-gray-700">
                        {new Date(selectedLien.scraped_at).toLocaleString()}
                      </p>
                    </div>
                    {selectedLien.property?.enriched_at && (
                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200/50">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
                          Enriched At
                        </label>
                        <p className="text-sm font-medium text-gray-700">
                          {new Date(
                            selectedLien.property.enriched_at,
                          ).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
