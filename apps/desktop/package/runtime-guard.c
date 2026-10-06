#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

/* fd 3 is Node's private IPC pipe; fd 4 is the inherited kernel lease. */
int main(int argc, char **argv) {
  if (argc < 4) return 64;
  if (!strcmp(argv[1], "--owner")) {
    int dir = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    struct stat info;
    if (dir < 0 || fstat(dir, &info) || info.st_uid != getuid() ||
        (info.st_mode & 077)) return 77;
    int fd = openat(dir, "runtime.lease", O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
    close(dir);
    if (fd < 0 || fstat(fd, &info) || !S_ISREG(info.st_mode) ||
        info.st_uid != getuid() || (info.st_mode & 077) || info.st_nlink != 1)
      return 77;
    if (flock(fd, LOCK_EX | LOCK_NB)) return errno == EWOULDBLOCK ? 73 : 74;
    if (fd != 4) {
      if (dup2(fd, 4) < 0) return 74;
      close(fd);
    }
    if (fcntl(4, F_SETFD, 0) < 0) return 74;
    if (setenv("DESKTOP_KERNEL_LEASE", "4", 1)) return 74;
    execv(argv[3], &argv[3]);
  } else if (!strcmp(argv[1], "--child")) {
    char *end;
    long parent = strtol(argv[2], &end, 10);
    if (*end || parent <= 1 || parent != getppid()) return 75;
    /* Recheck after prctl to cover parent death between getppid and prctl. */
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) || parent != getppid()) return 75;
    execv(argv[3], &argv[3]);
  } else return 64;
  return 126;
}
