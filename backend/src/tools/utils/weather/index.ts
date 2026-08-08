import { z } from "zod";
import { registerTool } from "../../tool-registry.js";

registerTool("get_weather", {
  description: "احصل على حالة الطقس لمدينة معينة. استخدم عندما يسأل المستخدم عن الطقس.",
  inputSchema: z.object({
    city: z.string().describe("اسم المدينة (مثال: 'Amman', 'Irbid', 'New York')"),
  }),
  execute: async ({ city }: { city: string }) => {
    try {
      const apiKey = process.env.WEATHER_API_KEY;
      if (!apiKey) {
        return JSON.stringify({ status: "unavailable", message: "خدمة الطقس غير متوفرة حالياً" });
      }
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=ar`
      );
      if (!res.ok) {
        if (res.status === 404) return JSON.stringify({ status: "error", message: `المدينة '${city}' غير موجودة` });
        return JSON.stringify({ status: "error", message: "فشل في جلب بيانات الطقس" });
      }
      const data: Record<string, unknown> = await res.json();
      const main = data.main as Record<string, unknown> | undefined;
      const sys = data.sys as Record<string, unknown> | undefined;
      const weather = data.weather as Array<Record<string, unknown>> | undefined;
      const wind = data.wind as Record<string, unknown> | undefined;
      const tempC = Math.round((main?.temp as number) ?? 0);
      const feelsLikeC = Math.round((main?.feels_like as number) ?? 0);
      const tempF = Math.round((tempC * 9) / 5 + 32);
      return JSON.stringify({
        status: "success",
        city: data.name,
        country: sys?.country,
        temp_c: tempC,
        temp_f: tempF,
        condition: weather?.[0]?.description,
        humidity: main?.humidity,
        wind_kph: Math.round(((wind?.speed as number) ?? 0) * 3.6),
        feelslike_c: feelsLikeC,
        visibility_km: Math.round(((data.visibility as number) ?? 0) / 1000),
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل في جلب الطقس", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
