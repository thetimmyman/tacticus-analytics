package com.tacticusanalytics.mobile;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Validates the selected format before opening a possibly truncating document
 * destination.
 */
final class DocumentExport {
  @FunctionalInterface
  interface Destination {
    OutputStream open() throws Exception;
  }
  static void write(JSONObject state, boolean backup, Destination destination) throws Exception {
    byte[] bytes = backup
        ? NativeBackup.encode(state)
        : MobileDocument.export(state).toString(2).getBytes(StandardCharsets.UTF_8);
    try (OutputStream output = destination.open()) {
      if (output == null)
        throw new Exception("Document destination unavailable");
      output.write(bytes);
    }
  }
}
