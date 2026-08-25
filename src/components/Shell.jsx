export default function Shell({ children }) {
  return (
    <main className="min-h-screen w-full bg-[#f8f9fa] text-[#1c1c1e]">
      <div
        className="
          mx-auto
          flex
          min-h-screen
          w-full
          max-w-full
          flex-col
          gap-5
          px-4
          py-4
          sm:px-6
          sm:py-6
          lg:px-8
          lg:py-6
        "
      >
        {children}
      </div>
    </main>
  );
}