import { ImageResponse } from "next/og";

export const alt = "Sverigeklättraren — öppen klätterkunskap från Sverigeföraren";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", padding: "72px", background: "#f5f1e8", color: "#17231d", fontFamily: "Georgia, serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "48px" }}>
        <div style={{ width: "190px", height: "190px", borderRadius: "42px", background: "#145742", color: "#fffdf7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "82px", fontWeight: 700 }}>SK</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ fontSize: "76px", fontWeight: 700 }}>Sverigeklättraren</div>
          <div style={{ fontSize: "34px", color: "#496158", fontFamily: "Arial, sans-serif" }}>Öppen klätterkunskap från Sverigeföraren</div>
        </div>
      </div>
    </div>,
    size,
  );
}
