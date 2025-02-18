import { CommunityContext } from "../modules/community/communityContext";

const commandArgs = () => (ctx: CommunityContext, next: () => void) => {
  if (ctx.message && ctx.message.text) {
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      const match = text.match(/^\/([^\s]+)\s?(.+)?/);
      const re_next_arg =
        /^\s*((?:(?:"(?:\\.|[^"])*")|(?:'[^']*')|\\.|\S)+)\s*(.*)$/;
      let args = [];
      let command;
      if (match !== null) {
        if (match[1]) {
          command = match[1];
        }
        let next_arg = ['', '', match[2]];
        while ((next_arg = re_next_arg.exec(next_arg[2])!)) {
          let quoted_arg = next_arg[1];
          let unquoted_arg = '';
          while (quoted_arg.length > 0) {
            if (/^"/.test(quoted_arg)) {
              const quoted_part = /^"((?:\\.|[^"])*)"(.*)$/.exec(quoted_arg);
              if (!quoted_part) break;
              unquoted_arg += quoted_part[1].replace(/\\(.)/g, '$1');
              quoted_arg = quoted_part[2];
            } else if (/^'/.test(quoted_arg)) {
              const quoted_part = /^'([^']*)'(.*)$/.exec(quoted_arg);
              if (!quoted_part) break;
              unquoted_arg += quoted_part[1];
              quoted_arg = quoted_part[2];
            } else if (/^\\/.test(quoted_arg)) {
              unquoted_arg += quoted_arg[1];
              quoted_arg = quoted_arg.substring(2);
            } else {
              unquoted_arg += quoted_arg[0];
              quoted_arg = quoted_arg.substring(1);
            }
          }
          args[args.length] = unquoted_arg;
        }
      }
      args = args.filter(arg => arg);

      ctx.state.command = {
        raw: text,
        command,
        args,
      };
    }
  }
  return next();
};

export default commandArgs;
