"use client";

import { useState, useCallback } from "react";

type UploadType = "trips" | "bookings" | "clients" | "hotels";
type Company = "tbt" | "aex";

const UPLOAD_CONFIGS: Record<UploadType, { label: string; description: string; columns: string[] }> = {
  trips: {
    label: "Trips",
    description: "Your 2026 trip inventory",
    columns: ["Trip Name*", "Date*", "Type", "Region", "Capacity*", "Price*", "Cost Basis", "Target Margin", "TDF (yes/no)", "Notes"],
  },
  bookings: {
    label: "Bookings",
    description: "Current bookings from your reservation system",
    columns: ["Booking ID", "Trip ID or Trip Name*", "Guests", "Price Paid", "Booking Date", "Status", "Email", "Client Name", "Private (yes/no)"],
  },
  clients: {
    label: "Clients",
    description: "Past clients and inquiries",
    columns: ["Email*", "First Name", "Last Name", "Phone", "Country", "City", "Fitness Level", "Total Trips", "Total Spend", "Last Trip Date", "Notes"],
  },
  hotels: {
    label: "Hotels",
    description: "Thomson hotel database for itinerary generation",
    columns: ["Hotel Name*", "Region*", "Country*", "City", "Stars", "Cost Per Room", "Routes", "Rooms Available", "Lead Time (Days)", "Contact Name", "Contact Email", "Preferred (yes/no)", "Notes"],
  },
};

export default function UploadPage() {
  const [uploadType, setUploadType] = useState<UploadType>("trips");
  const [company, setCompany] = useState<Company>("tbt");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    inserted: number; errors: string[]; total_rows: number;
  } | null>(null);

  const config = UPLOAD_CONFIGS[uploadType];

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", uploadType);
    formData.append("company", company);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setResult({ inserted: data.inserted, errors: data.errors || [], total_rows: data.total_rows });
        setFile(null);
      } else {
        setResult({ inserted: 0, errors: [data.error], total_rows: 0 });
      }
    } catch (err) {
      setResult({ inserted: 0, errors: ["Upload failed — check your connection"], total_rows: 0 });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="animate-fade-in max-w-2xl">
      <div className="mb-8">
        <h1 className="section-header">Data Import</h1>
        <p className="text-night-400 text-sm">
          Upload Excel or CSV files to populate the platform. Flybook exports are supported natively.
        </p>
      </div>

      {/* Flybook callout */}
      <div className="mb-6 border border-aurora-blue border-opacity-30 bg-night-900 rounded-xl p-3 sm:p-4">
        <div className="flex gap-3">
          <span className="text-aurora-blue text-lg flex-shrink-0">◈</span>
          <div>
            <p className="text-night-200 text-sm font-medium mb-1">Flybook exports supported</p>
            <p className="text-night-500 text-xs leading-relaxed">
              Export from Flybook via <span className="font-mono text-night-300">Reports → Reservations</span> (for bookings)
              or <span className="font-mono text-night-300">Reports → Customers</span> (for clients).
              CSV or Excel both work. Flybook's date format quirks are handled automatically.
            </p>
          </div>
        </div>
      </div>

      {/* Upload type selection */}
      <div className="card mb-6">
        <div className="label mb-3">What are you uploading?</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(Object.keys(UPLOAD_CONFIGS) as UploadType[]).map((type) => (
            <button
              key={type}
              onClick={() => setUploadType(type)}
              className={`p-3 rounded-lg border text-left transition-all ${
                uploadType === type
                  ? "border-aurora-green bg-night-800 text-night-50"
                  : "border-night-700 text-night-400 hover:border-night-600"
              }`}
            >
              <div className="font-medium text-sm">{UPLOAD_CONFIGS[type].label}</div>
              <div className="text-xs text-night-500 mt-0.5 hidden sm:block">{UPLOAD_CONFIGS[type].description}</div>
            </button>
          ))}
        </div>

        {/* Company selector */}
        <div>
          <div className="label mb-2">Which company?</div>
          <div className="flex gap-2">
            {(["tbt", "aex"] as Company[]).map((co) => (
              <button
                key={co}
                onClick={() => setCompany(co)}
                className={`px-4 py-1.5 rounded-lg border text-sm font-mono transition-all ${
                  company === co
                    ? "border-aurora-green bg-night-800 text-aurora-green"
                    : "border-night-700 text-night-400 hover:border-night-600"
                }`}
              >
                {co.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Column guide */}
      <div className="card mb-6">
        <div className="label mb-3">Expected columns {`(* required)`}</div>
        <div className="flex flex-wrap gap-1.5">
          {config.columns.map((col) => (
            <span
              key={col}
              className={`text-xs font-mono px-2 py-1 rounded border ${
                col.endsWith("*")
                  ? "bg-night-800 border-aurora-green border-opacity-40 text-aurora-green"
                  : "bg-night-900 border-night-700 text-night-400"
              }`}
            >
              {col.replace("*", "")}
            </span>
          ))}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        className={`border-2 border-dashed rounded-xl p-6 sm:p-10 text-center transition-all mb-4 ${
          isDragging
            ? "border-aurora-green bg-night-900"
            : file
            ? "border-night-600 bg-night-900"
            : "border-night-700 hover:border-night-600"
        }`}
      >
        {file ? (
          <div>
            <div className="text-aurora-green text-2xl mb-2">✓</div>
            <p className="text-night-200 font-medium break-all">{file.name}</p>
            <p className="text-night-500 text-xs mt-1">{(file.size / 1024).toFixed(1)} KB</p>
            <button
              onClick={() => setFile(null)}
              className="text-xs text-night-500 hover:text-night-300 mt-2 underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <div className="text-night-600 text-3xl mb-3">⊕</div>
            <p className="text-night-400 text-sm mb-2">
              Drop your Excel or CSV file here
            </p>
            <label className="cursor-pointer">
              <span className="btn-secondary text-xs">Browse files</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        )}
      </div>

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="btn-primary w-full py-2.5"
      >
        {uploading ? "Uploading..." : `Upload ${config.label}`}
      </button>

      {/* Result */}
      {result && (
        <div className={`mt-4 card ${result.inserted > 0 ? "border-aurora-green border-opacity-30" : "border-red-900"}`}>
          {result.inserted > 0 && (
            <p className="text-aurora-green text-sm font-medium mb-1">
              ✓ {result.inserted} of {result.total_rows} rows imported successfully
            </p>
          )}
          {result.errors.length > 0 && (
            <div>
              <p className="text-red-400 text-sm font-medium mb-2">
                {result.errors.length} error{result.errors.length !== 1 ? "s" : ""}:
              </p>
              <ul className="space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-red-300 text-xs font-mono break-all">· {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
