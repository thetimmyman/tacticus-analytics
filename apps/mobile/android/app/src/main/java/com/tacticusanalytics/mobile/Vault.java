package com.tacticusanalytics.mobile;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Native broker only: credentials never enter workspace documents or a web bridge. */
final class Vault {
  private final File directory;
  private static final String ALIAS = "official-read-v1";
  interface Operation<T> {
    T run(String credential) throws Exception;
  }
  Vault(Context context) {
    directory = new File(context.getNoBackupFilesDir(), "official-vault");
  }
  private SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (!store.containsAlias(ALIAS)) {
      KeyGenerator generator =
          KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(new KeyGenParameterSpec
              .Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .setKeySize(256)
              .setRandomizedEncryptionRequired(true)
              .build());
      generator.generateKey();
    }
    return (SecretKey) store.getKey(ALIAS, null);
  }
  String store(String credential) throws Exception {
    if (credential.trim().isEmpty() || credential.length() > 4096
        || credential.chars().anyMatch(item -> item < 32 || item == 127))
      throw new Exception("Secure input unavailable");
    if (!directory.isDirectory() && !directory.mkdirs())
      throw new Exception("Secure storage unavailable");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    byte[] body = cipher.doFinal(credential.getBytes(StandardCharsets.UTF_8));
    byte[] blob = new byte[12 + body.length];
    System.arraycopy(cipher.getIV(), 0, blob, 0, 12);
    System.arraycopy(body, 0, blob, 12, body.length);
    String handle = UUID.randomUUID().toString();
    Files.write(file(handle).toPath(), blob);
    return handle;
  }
  <T> T withCredential(String handle, Operation<T> operation) throws Exception {
    byte[] blob = Files.readAllBytes(file(handle).toPath());
    if (blob.length < 28 || blob.length > 8192)
      throw new Exception("Secure storage unavailable");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, blob, 0, 12));
    byte[] clear = cipher.doFinal(blob, 12, blob.length - 12);
    try {
      return operation.run(new String(clear, StandardCharsets.UTF_8));
    } finally {
      java.util.Arrays.fill(clear, (byte) 0);
    }
  }
  void remove(String handle) throws Exception {
    Files.deleteIfExists(file(handle).toPath());
  }
  void sweep(java.util.Set<String> retained) throws Exception {
    File[] files = directory.listFiles();
    if (files == null)
      return;
    for (File item : files)
      if (!retained.contains(item.getName()))
        Files.deleteIfExists(item.toPath());
  }
  private File file(String handle) throws Exception {
    if (!handle.matches("[a-f0-9-]{36}"))
      throw new Exception("Invalid vault reference");
    return new File(directory, handle);
  }
}
