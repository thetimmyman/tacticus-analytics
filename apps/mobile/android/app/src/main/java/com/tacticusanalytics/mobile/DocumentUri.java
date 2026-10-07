package com.tacticusanalytics.mobile;

import android.content.ContentResolver;
import android.net.Uri;
import java.util.Locale;

/**
 * Document picker results only. A file:// or own-package URI would let the content resolver read
 * or overwrite this application's private files.
 */
final class DocumentUri {
  static Uri require(Uri uri, String packageName) throws Exception {
    if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()))
      throw new Exception("Unsupported document location");
    String authority = uri.getAuthority();
    String own = packageName.toLowerCase(Locale.ROOT);
    if (authority == null || authority.isEmpty()
        || authority.toLowerCase(Locale.ROOT).equals(own)
        || authority.toLowerCase(Locale.ROOT).startsWith(own + "."))
      throw new Exception("Unsupported document location");
    return uri;
  }
}
