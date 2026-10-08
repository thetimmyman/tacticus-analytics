package com.tacticusanalytics.mobile;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Bound nesting before the platform parser can recurse over untrusted documents. */
final class StrictJson {
  static final int MAX_DOCUMENT = 4 * 1024 * 1024;
  static JSONObject parse(byte[] bytes) throws Exception {
    return parse(bytes, MAX_DOCUMENT);
  }
  static JSONObject parse(byte[] bytes, int limit) throws Exception {
    if (bytes.length > limit)
      throw new Exception("Document size limit");
    String text = StandardCharsets.UTF_8.newDecoder()
                      .onMalformedInput(CodingErrorAction.REPORT)
                      .onUnmappableCharacter(CodingErrorAction.REPORT)
                      .decode(ByteBuffer.wrap(bytes))
                      .toString();
    return parse(text, limit);
  }
  static JSONObject parse(String text) throws Exception {
    return parse(text, MAX_DOCUMENT);
  }
  private static JSONObject parse(String text, int limit) throws Exception {
    if (text.length() > limit)
      throw new Exception("Document size limit");
    boolean quoted = false, escaped = false;
    int depth = 0;
    for (int i = 0; i < text.length(); i++) {
      char item = text.charAt(i);
      if (quoted) {
        if (escaped)
          escaped = false;
        else if (item == '\\')
          escaped = true;
        else if (item == '"')
          quoted = false;
      } else if (item == '"')
        quoted = true;
      else if (item == '{' || item == '[') {
        if (++depth > 12)
          throw new Exception("Document nesting limit");
      } else if (item == '}' || item == ']') {
        if (--depth < 0)
          throw new Exception("Malformed document");
      }
    }
    if (depth != 0 || quoted)
      throw new Exception("Malformed document");
    return new JSONObject(text);
  }
}
