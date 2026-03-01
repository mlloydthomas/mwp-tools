import Sidebar from "@/components/shared/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0">
        <div className="max-w-6xl mx-auto px-4 pt-[72px] pb-6 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
