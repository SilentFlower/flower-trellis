    if spec_index_paths:
        output.write("## Available indexes (read on demand)\n")
        for p in spec_index_paths:
            output.write(f"- {p}\n")
        output.write("\n")
