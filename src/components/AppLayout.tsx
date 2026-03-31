import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";

const AppLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="relative flex min-h-screen bg-background texture-lines">
      <AppSidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-12 md:px-8 lg:px-12 lg:py-16">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
