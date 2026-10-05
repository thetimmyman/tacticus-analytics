#include <sys/event.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <mach-o/dyld.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pwd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* The watcher survives owner death; the owner cleans up if the watcher dies.
 * Only foreground, non-daemonizing first-party service trees are supported. */
static volatile sig_atomic_t interrupted;
static void interrupt(int value) { interrupted = value; }
static void stop_group(pid_t group) {
  if (group <= 1) return;
  kill(-group, SIGTERM);
  for (int n = 0; n < 50; n++) {
    if (kill(-group, 0) < 0 && errno == ESRCH) return;
    usleep(100000);
  }
  kill(-group, SIGKILL);
}
static int watch_exit(int queue, pid_t pid) {
  struct kevent event;
  EV_SET(&event, pid, EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
  return kevent(queue, &event, 1, NULL, 0, NULL);
}
static int private_directory(const char *path) {
  if (mkdir(path, 0700) < 0 && errno != EEXIST) return -1;
  int fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (fd < 0) return -1;
  struct stat info;
  int valid = fstat(fd, &info) == 0 && S_ISDIR(info.st_mode) &&
      info.st_uid == getuid() && (info.st_mode & 077) == 0;
  close(fd);
  return valid ? 0 : -1;
}
int main(int argc, char **argv) {
  char lock_path[PATH_MAX], node[PATH_MAX], entry[PATH_MAX];
  char executable[PATH_MAX];
  char **command;
  char **owned = NULL;
  if (argc >= 4 && strcmp(argv[1], "--run") == 0) {
    if (strlen(argv[2]) >= sizeof(lock_path)) return 64;
    strcpy(lock_path, argv[2]);
    command = &argv[3];
  } else {
    uint32_t length = sizeof(executable);
    if (_NSGetExecutablePath(executable, &length) != 0) return 64;
    char *slash = strrchr(executable, '/');
    if (!slash) return 64;
    *slash = '\0';
    if (snprintf(node, sizeof(node), "%s/../Resources/runtime/bin/node", executable) >= PATH_MAX ||
        snprintf(entry, sizeof(entry), "%s/../Resources/runtime/apps/desktop/platform/macos/runtime.mjs", executable) >= PATH_MAX)
      return 64;
    struct passwd *user = getpwuid(getuid());
    if (!user) return 64;
    char state[PATH_MAX];
    if (snprintf(state, sizeof(state), "%s/Library/Application Support/Tacticus Analytics Preview", user->pw_dir) >= PATH_MAX ||
        private_directory(state) < 0 ||
        snprintf(lock_path, sizeof(lock_path), "%s/owner.lock", state) >= PATH_MAX)
      return 73;
    owned = calloc((size_t)argc + 3, sizeof(char *));
    if (!owned) return 71;
    owned[0] = node;
    owned[1] = entry;
    for (int n = 1; n < argc; n++) owned[n + 1] = argv[n];
    command = owned;
  }
  if (lock_path[0] != '/' || command[0][0] != '/') return 64;
  int lock = open(lock_path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  struct stat info;
  if (lock < 0 || fstat(lock, &info) < 0 || !S_ISREG(info.st_mode) ||
      info.st_uid != getuid() || (info.st_mode & 077) != 0 ||
      flock(lock, LOCK_EX | LOCK_NB) < 0) return 73;
  int status_pipe[2];
  if (pipe(status_pipe) < 0) return 71;
  signal(SIGTERM, interrupt);
  signal(SIGINT, interrupt);
  pid_t owner = getpid();
  pid_t watcher = fork();
  if (watcher < 0) return 71;
  if (watcher == 0) {
    close(status_pipe[0]);
    int queue = kqueue();
    if (queue < 0 || watch_exit(queue, owner) < 0 || getppid() != owner) _exit(71);
    int barrier[2];
    if (pipe(barrier) < 0) _exit(71);
    pid_t child = fork();
    if (child < 0) _exit(71);
    if (child == 0) {
      close(barrier[1]);
      close(status_pipe[1]);
      close(queue);
      close(lock);
      if (setsid() < 0) _exit(71);
      char byte;
      if (read(barrier[0], &byte, 1) != 1) _exit(71);
      close(barrier[0]);
      if (interrupted) _exit(130);
      signal(SIGTERM, SIG_DFL);
      signal(SIGINT, SIG_DFL);
      setenv("TA_MAC_GUARD_LOCK", lock_path, 1);
      execv(command[0], command);
      _exit(127);
    }
    close(barrier[0]);
    if (watch_exit(queue, child) < 0 ||
        write(status_pipe[1], &child, sizeof(child)) != sizeof(child) ||
        write(barrier[1], "1", 1) != 1) {
      close(barrier[1]);
      kill(child, SIGKILL);
      stop_group(child);
      _exit(71);
    }
    close(barrier[1]);
    close(status_pipe[1]);
    struct timespec timeout = {0, 100000000};
    int status = 0;
    for (;;) {
      struct kevent event;
      int ready = kevent(queue, NULL, 0, &event, 1, &timeout);
      if (interrupted || ready < 0 ||
          (ready == 1 && (event.flags & EV_ERROR || event.ident == (uintptr_t)owner))) {
        stop_group(child);
        kill(child, SIGKILL);
        waitpid(child, &status, 0);
        _exit(130);
      }
      if (ready == 1 && event.ident == (uintptr_t)child) {
        stop_group(child);
        waitpid(child, &status, 0);
        _exit(WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status));
      }
    }
  }
  close(status_pipe[1]);
  pid_t group = 0;
  ssize_t received = read(status_pipe[0], &group, sizeof(group));
  close(status_pipe[0]);
  int status;
  if (interrupted) kill(watcher, SIGTERM);
  for (;;) {
    pid_t ended = waitpid(watcher, &status, 0);
    if (ended == watcher) break;
    if (ended < 0 && errno != EINTR) return 71;
    if (interrupted) kill(watcher, SIGTERM);
  }
  if (received == sizeof(group) && WIFSIGNALED(status)) stop_group(group);
  close(lock);
  free(owned);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
