import { fixture } from "../test/fixture";
import { addStressFiles } from "../test/stress-fixture";
if (process.env.HDFS_STRESS_FIXTURES === "1") addStressFiles();
void fixture(Number(process.env.HDFS_FIXTURE_PORT ?? "18790")).then(
  (server) => {
    console.log(server.endpoint);
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => {
        void server.close().then(() => process.exit(0));
      });
  },
);
