package com.tacticusanalytics.mobile;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

interface OfficialSource {
  final class Refused extends Exception {}
  JSONObject get(String scope, String credential) throws Exception;
  final class Device implements OfficialSource {
    @Override
    public JSONObject get(String scope, String credential) throws Exception {
      String path = switch (scope) {
        case "Player" -> "/api/v1/player";
        case "Guild" -> "/api/v1/guild";
        case "Guild Raid" -> "/api/v1/guildRaid";
        default -> throw new Exception("Unsupported capability");
      };
      HttpsURLConnection connection =
          (HttpsURLConnection) new URL("https://api.tacticusgame.com" + path).openConnection();
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(15000);
      connection.setRequestProperty("X-API-KEY", credential);
      connection.setRequestProperty("Accept", "application/json");
      try {
        int status = connection.getResponseCode();
        if (status == 401 || status == 403)
          throw new Refused();
        if (status != 200)
          throw new Exception("Official access unavailable; retained data remains readable");
        try (InputStream stream = connection.getInputStream();
            ByteArrayOutputStream body = new ByteArrayOutputStream()) {
          byte[] buffer = new byte[8192];
          long deadline = android.os.SystemClock.elapsedRealtime() + 30000;
          int length;
          while ((length = stream.read(buffer)) != -1) {
            if (android.os.SystemClock.elapsedRealtime() > deadline)
              throw new Exception("Official source time limit");
            if (body.size() + length > 4 * 1024 * 1024)
              throw new Exception("Official response limit");
            body.write(buffer, 0, length);
          }
          return StrictJson.parse(body.toByteArray());
        }
      } finally {
        connection.disconnect();
      }
    }
  }
}
