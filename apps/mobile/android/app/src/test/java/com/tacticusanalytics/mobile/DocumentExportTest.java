package com.tacticusanalytics.mobile;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;

public class DocumentExportTest {
  @Test
  public void rejectedPortableExportNeverOpensOrTruncatesExistingDestination() throws Exception {
    Path destination = Files.createTempFile("synthetic-document-export-", ".json");
    byte[] previous = "Synthetic previous document".getBytes(StandardCharsets.UTF_8);
    AtomicInteger opened = new AtomicInteger();
    try {
      Files.write(destination, previous);
      JSONObject state = MobileDocumentTest.canonicalState(32767);
      String original = state.toString();
      assertThrows(Exception.class, () -> DocumentExport.write(state, false, () -> {
        opened.incrementAndGet();
        return new FileOutputStream(destination.toFile());
      }));
      assertArrayEquals(previous, Files.readAllBytes(destination));
      assertEquals(0, opened.get());
      assertEquals(original, state.toString());
    } finally {
      Files.deleteIfExists(destination);
    }
  }
  @Test
  public void rejectedNativeBackupAlsoLeavesExistingDestinationUntouched() throws Exception {
    Path destination = Files.createTempFile("synthetic-backup-export-", ".json");
    byte[] previous = "Synthetic previous backup".getBytes(StandardCharsets.UTF_8);
    AtomicInteger opened = new AtomicInteger();
    try {
      Files.write(destination, previous);
      JSONObject state = MobileDocumentTest.canonicalState(32767).put("schemaVersion", 2);
      assertThrows(Exception.class, () -> DocumentExport.write(state, true, () -> {
        opened.incrementAndGet();
        return new FileOutputStream(destination.toFile());
      }));
      assertArrayEquals(previous, Files.readAllBytes(destination));
      assertEquals(0, opened.get());
    } finally {
      Files.deleteIfExists(destination);
    }
  }
  @Test
  public void validExportsWriteReadableSelectedFormatsAndKeepOriginalState() throws Exception {
    for (boolean backup : new boolean[] {false, true}) {
      JSONObject state = MobileDocumentTest.canonicalState(backup ? 32767 : 60);
      String original = state.toString();
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      AtomicInteger opened = new AtomicInteger(), closed = new AtomicInteger();
      DocumentExport.write(state, backup, () -> {
        opened.incrementAndGet();
        return new OutputStream() {
          @Override
          public void write(int value) {
            output.write(value);
          }
          @Override
          public void close() {
            closed.incrementAndGet();
          }
        };
      });
      JSONObject document = StrictJson.parse(output.toByteArray(), NativeBackup.MAX_FILE_BYTES);
      if (backup) {
        assertEquals("android-local-backup/v1", document.getString("schemaVersion"));
        JSONObject restored = NativeBackup.importDocument(document);
        assertEquals(32767,
            restored.getJSONObject("personal")
                .getJSONArray("roster")
                .getJSONObject(0)
                .getInt("xpLevel"));
        assertEquals(7,
            restored.getJSONObject("personal")
                .getJSONArray("roster")
                .getJSONObject(0)
                .getInt("mythicShards"));
      } else {
        MobileDocument.validate(document);
        assertEquals("mobile-workspace/v1", document.getString("schemaVersion"));
        assertEquals(60,
            document.getJSONObject("player").getJSONArray("units").getJSONObject(0).getInt(
                "xpLevel"));
      }
      assertEquals(101,
          document.has("raids") ? document.getJSONArray("raids").getJSONObject(0).getLong("damage")
                                : NativeBackup.importDocument(document)
                                      .getJSONArray("portableRaids")
                                      .getJSONObject(0)
                                      .getLong("damage"));
      assertEquals(1, opened.get());
      assertEquals(1, closed.get());
      assertEquals(original, state.toString());
    }
  }
  @Test
  public void unavailableDestinationsRefuseWithoutChangingWorkspace() throws Exception {
    JSONObject state = MobileDocumentTest.canonicalState(60);
    String original = state.toString();
    assertThrows(Exception.class, () -> DocumentExport.write(state, false, () -> null));
    assertThrows(IOException.class, () -> DocumentExport.write(state, true, () -> {
      throw new IOException("Synthetic destination unavailable");
    }));
    assertEquals(original, state.toString());
  }
  @Test
  public void failedWriteClosesDestinationAndDoesNotClaimAtomicFileReplacement() throws Exception {
    AtomicInteger closed = new AtomicInteger();
    JSONObject state = MobileDocumentTest.canonicalState(60);
    assertThrows(
        IOException.class, () -> DocumentExport.write(state, false, () -> new OutputStream() {
          @Override
          public void write(int value) throws IOException {
            throw new IOException("Synthetic write failure");
          }
          @Override
          public void close() {
            closed.incrementAndGet();
          }
        }));
    assertEquals(1, closed.get());
  }
}
